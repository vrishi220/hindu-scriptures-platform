from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

import anthropic
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from api.pipelines import generate_content as generation_pipeline
from api.users import require_permission
from models.ai_job import AIJob
from models.book import Book
from models.database import SessionLocal
from models.user import User
from services import get_db

router = APIRouter(prefix="/ai/generate", tags=["ai-generation"])


_CANCEL_FLAGS: dict[int, threading.Event] = {}


class GenerationStartRequest(BaseModel):
    book_id: int
    language_code: Literal["en", "te", "hi", "ta"]
    language_name: str
    mode: Literal["realtime", "batch"]
    limit: int | None = None
    api_key: str | None = None


class GenerationStartResponse(BaseModel):
    job_id: int
    estimated_cost_realtime: float
    estimated_cost_batch: float


class AIJobPublic(BaseModel):
    id: int
    job_type: str
    book_id: int | None
    language_code: str | None
    model: str | None
    status: str
    total_nodes: int
    processed_nodes: int
    failed_nodes: int
    estimated_cost_usd: float | None
    actual_cost_usd: float | None
    started_at: datetime | None
    completed_at: datetime | None
    error_log: list[dict] | None
    metadata: dict | None
    created_by: int | None
    created_at: datetime | None


class BatchStatusSnapshot(BaseModel):
    batch_id: str
    processing_status: str | None = None
    status: str | None = None
    requests_total: int | None = None
    requests_completed: int | None = None
    requests_processing: int | None = None
    error: str | None = None
    retrieved_at: datetime


class AIJobWithBatchSnapshotPublic(AIJobPublic):
    batch_status_snapshot: BatchStatusSnapshot | None = None


class BookCostSummary(BaseModel):
    book_name: str
    total_cost: float
    verses_generated: int


class LanguageCoverageSummary(BaseModel):
    language_code: str
    verse_count: int


class GenerationSummaryResponse(BaseModel):
    total_jobs: int
    total_verses_generated: int
    total_cost_usd: float
    projected_total_cost_usd: float
    jobs_by_status: dict[str, int]
    cost_by_book: list[BookCostSummary]
    languages_covered: list[LanguageCoverageSummary]


def _serialize_job(job: AIJob) -> AIJobPublic:
    return AIJobPublic(
        id=job.id,
        job_type=job.job_type,
        book_id=job.book_id,
        language_code=job.language_code,
        model=job.model,
        status=job.status,
        total_nodes=job.total_nodes,
        processed_nodes=job.processed_nodes,
        failed_nodes=job.failed_nodes,
        estimated_cost_usd=float(job.estimated_cost_usd) if job.estimated_cost_usd is not None else None,
        actual_cost_usd=float(job.actual_cost_usd) if job.actual_cost_usd is not None else None,
        started_at=job.started_at,
        completed_at=job.completed_at,
        error_log=job.error_log,
        metadata=job.metadata_json,
        created_by=job.created_by,
        created_at=job.created_at,
    )


def _fetch_live_batch_snapshot(batch_id: str) -> BatchStatusSnapshot:
    now = datetime.now(tz=timezone.utc)
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return BatchStatusSnapshot(
            batch_id=batch_id,
            error="ANTHROPIC_API_KEY not configured for live batch lookup",
            retrieved_at=now,
        )

    try:
        client = anthropic.Anthropic(api_key=api_key)
        status_obj = client.beta.messages.batches.retrieve(batch_id)
        counts = generation_pipeline._obj_get(status_obj, "request_counts")
        succeeded = int(generation_pipeline._obj_get(counts, "succeeded", 0) or 0)
        errored = int(generation_pipeline._obj_get(counts, "errored", 0) or 0)
        canceled = int(generation_pipeline._obj_get(counts, "canceled", 0) or 0)
        expired = int(generation_pipeline._obj_get(counts, "expired", 0) or 0)
        processing = int(generation_pipeline._obj_get(counts, "processing", 0) or 0)
        completed = succeeded + errored + canceled + expired
        total = completed + processing

        return BatchStatusSnapshot(
            batch_id=batch_id,
            processing_status=generation_pipeline._obj_get(status_obj, "processing_status"),
            status=generation_pipeline._obj_get(status_obj, "status"),
            requests_total=total if total > 0 else None,
            requests_completed=completed if total > 0 else None,
            requests_processing=processing if total > 0 else None,
            retrieved_at=now,
        )
    except Exception as exc:  # noqa: BLE001
        return BatchStatusSnapshot(
            batch_id=batch_id,
            error=str(exc),
            retrieved_at=now,
        )


def _serialize_job_with_snapshot(job: AIJob) -> AIJobWithBatchSnapshotPublic:
    base = _serialize_job(job)
    metadata = job.metadata_json or {}
    batch_id = metadata.get("batch_id")
    snapshot = _fetch_live_batch_snapshot(batch_id) if batch_id else None
    return AIJobWithBatchSnapshotPublic(
        **base.model_dump(),
        batch_status_snapshot=snapshot,
    )


def _mark_job_cancelled(db: Session, job: AIJob) -> None:
    job.status = "cancelled"
    job.completed_at = datetime.now(tz=timezone.utc)
    metadata = dict(job.metadata_json or {})
    metadata["cancel_requested"] = True
    job.metadata_json = metadata
    db.commit()


def _job_cancel_requested(db: Session, job_id: int, cancel_event: threading.Event) -> bool:
    if cancel_event.is_set():
        return True
    status_value = db.query(AIJob.status).filter(AIJob.id == job_id).scalar()
    return status_value == "cancelled"


def _apply_progress(db: Session, job: AIJob, processed: int, failed: int) -> None:
    job.processed_nodes = processed
    job.failed_nodes = failed
    db.commit()


def _run_generation_job_task(
    job_id: int,
    book_id: int,
    language_code: str,
    language_name: str,
    mode: Literal["realtime", "batch"],
    limit: int | None,
    api_key_override: str | None,
) -> None:
    db = SessionLocal()
    cancel_event = _CANCEL_FLAGS.setdefault(job_id, threading.Event())
    model = generation_pipeline.DEFAULT_MODEL
    processed = 0
    failed = 0
    error_log: list[dict] = []

    try:
        job = db.query(AIJob).filter(AIJob.id == job_id).first()
        if not job:
            return

        api_key = api_key_override or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            job.status = "failed"
            job.completed_at = datetime.now(tz=timezone.utc)
            job.error_log = [{"error": "ANTHROPIC_API_KEY not set"}]
            db.commit()
            return

        client = anthropic.Anthropic(api_key=api_key)

        book = db.query(Book).filter(Book.id == book_id).first()
        if not book:
            job.status = "failed"
            job.completed_at = datetime.now(tz=timezone.utc)
            job.error_log = [{"error": f"Book id={book_id} not found"}]
            db.commit()
            return

        job.status = "running"
        if job.started_at is None:
            job.started_at = datetime.now(tz=timezone.utc)
        db.commit()

        author = generation_pipeline._resolve_hsp_ai_author(db)
        work = generation_pipeline._resolve_commentary_work(db, author, language_name)

        translation_author = generation_pipeline._resolve_hsp_ai_translation_author(db)
        generation_pipeline._seed_hsp_ai_translation_works(db, translation_author)
        translation_work = generation_pipeline._resolve_or_create_translation_work(
            db,
            translation_author,
            language_name,
            language_code,
        )
        db.commit()

        nodes = generation_pipeline._fetch_nodes_missing_translation(
            db,
            book,
            language_code,
            translation_work.id,
            limit,
        )
        job.total_nodes = len(nodes)
        _apply_progress(db, job, processed=0, failed=0)

        if not nodes:
            job.status = "completed"
            job.completed_at = datetime.now(tz=timezone.utc)
            db.commit()
            return

        if mode == "batch":
            batch_id = generation_pipeline._submit_batch(
                client=client,
                model=model,
                book_name=book.book_name,
                nodes=nodes,
                language_name=language_name,
            )
            metadata = dict(job.metadata_json or {})
            metadata["batch_id"] = batch_id
            metadata["mode"] = "batch"
            job.metadata_json = metadata
            db.commit()

            started = datetime.now(tz=timezone.utc)
            while True:
                if _job_cancel_requested(db, job_id, cancel_event):
                    try:
                        client.beta.messages.batches.cancel(batch_id)
                    except Exception:
                        pass
                    _mark_job_cancelled(db, job)
                    return

                status_obj = client.beta.messages.batches.retrieve(batch_id)
                status_text = str(
                    generation_pipeline._obj_get(status_obj, "processing_status")
                    or generation_pipeline._obj_get(status_obj, "status")
                    or "unknown"
                ).lower()

                if status_text == "ended":
                    break
                if status_text in {"canceled", "cancelled", "expired", "failed"}:
                    raise RuntimeError(f"Batch did not complete successfully (status={status_text})")

                elapsed = (datetime.now(tz=timezone.utc) - started).total_seconds()
                if elapsed > generation_pipeline.BATCH_MAX_WAIT_SECONDS:
                    raise TimeoutError(
                        f"Timed out waiting for batch completion after {int(elapsed)}s "
                        f"(max={generation_pipeline.BATCH_MAX_WAIT_SECONDS}s)"
                    )
                time.sleep(generation_pipeline.BATCH_POLL_INTERVAL_SECONDS)

            batch_successes, batch_failures = generation_pipeline._collect_batch_results(client, batch_id)

            for node in nodes:
                if _job_cancel_requested(db, job_id, cancel_event):
                    _mark_job_cancelled(db, job)
                    return

                try:
                    if node.id not in batch_successes:
                        raise ValueError(batch_failures.get(node.id, "No result returned for node"))

                    translation, commentary = batch_successes[node.id]
                    generation_pipeline._write_results(
                        db=db,
                        node=node,
                        translation=translation,
                        commentary=commentary,
                        language_code=language_code,
                        translation_work=translation_work,
                        translation_author=translation_author,
                        work=work,
                        author=author,
                        ai_job_id=job.id,
                        model=model,
                    )
                    db.commit()
                    processed += 1
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    failed += 1
                    error_log.append(
                        {
                            "node_id": node.id,
                            "sequence_number": node.sequence_number,
                            "error": str(exc),
                        }
                    )
                _apply_progress(db, job, processed, failed)

        else:
            for node in nodes:
                if _job_cancel_requested(db, job_id, cancel_event):
                    _mark_job_cancelled(db, job)
                    return

                try:
                    result = generation_pipeline._call_claude(
                        client=client,
                        model=model,
                        book_name=book.book_name,
                        node=node,
                        language_name=language_name,
                        language_code=language_code,
                    )
                    if result is None:
                        raise ValueError("Claude did not return a tool_use block")

                    translation, commentary = result
                    generation_pipeline._write_results(
                        db=db,
                        node=node,
                        translation=translation,
                        commentary=commentary,
                        language_code=language_code,
                        translation_work=translation_work,
                        translation_author=translation_author,
                        work=work,
                        author=author,
                        ai_job_id=job.id,
                        model=model,
                    )
                    db.commit()
                    processed += 1
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    failed += 1
                    error_log.append(
                        {
                            "node_id": node.id,
                            "sequence_number": node.sequence_number,
                            "error": str(exc),
                        }
                    )
                _apply_progress(db, job, processed, failed)

        job.status = "completed"
        job.completed_at = datetime.now(tz=timezone.utc)
        if error_log:
            job.error_log = error_log
        db.commit()

    except Exception as exc:  # noqa: BLE001
        job = db.query(AIJob).filter(AIJob.id == job_id).first()
        if job:
            job.status = "failed"
            job.completed_at = datetime.now(tz=timezone.utc)
            full_error_log = list(job.error_log or [])
            full_error_log.append({"error": str(exc)})
            job.error_log = full_error_log
            db.commit()
    finally:
        db.close()
        _CANCEL_FLAGS.pop(job_id, None)


@router.post("/start", response_model=GenerationStartResponse)
def start_generation(
    payload: GenerationStartRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> GenerationStartResponse:
    book = db.query(Book).filter(Book.id == payload.book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    translation_author = generation_pipeline._resolve_hsp_ai_translation_author(db)
    generation_pipeline._seed_hsp_ai_translation_works(db, translation_author)
    translation_work = generation_pipeline._resolve_or_create_translation_work(
        db,
        translation_author,
        payload.language_name,
        payload.language_code,
    )
    db.commit()

    nodes = generation_pipeline._fetch_nodes_missing_translation(
        db,
        book,
        payload.language_code,
        translation_work.id,
        payload.limit,
    )
    est_realtime, est_batch = generation_pipeline._estimate_cost(nodes)

    job = AIJob(
        job_type=generation_pipeline.JOB_TYPE,
        book_id=book.id,
        language_code=payload.language_code,
        model=generation_pipeline.DEFAULT_MODEL,
        status="pending",
        total_nodes=len(nodes),
        processed_nodes=0,
        failed_nodes=0,
        estimated_cost_usd=Decimal(f"{est_realtime:.4f}"),
        metadata_json={
            "book_code": book.book_code,
            "language_name": payload.language_name,
            "mode": payload.mode,
            "limit": payload.limit,
        },
        created_by=current_user.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        _run_generation_job_task,
        job.id,
        payload.book_id,
        payload.language_code,
        payload.language_name,
        payload.mode,
        payload.limit,
        payload.api_key,
    )

    return GenerationStartResponse(
        job_id=job.id,
        estimated_cost_realtime=round(est_realtime, 4),
        estimated_cost_batch=round(est_batch, 4),
    )


@router.get("/jobs", response_model=list[AIJobWithBatchSnapshotPublic])
def list_generation_jobs(
    status_filter: Literal["running", "completed", "failed"] | None = Query(default=None, alias="status"),
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> list[AIJobWithBatchSnapshotPublic]:
    query = db.query(AIJob).order_by(AIJob.created_at.desc())
    if status_filter is not None:
        query = query.filter(AIJob.status == status_filter)
    return [_serialize_job_with_snapshot(job) for job in query.all()]


@router.get("/jobs/{job_id}", response_model=AIJobWithBatchSnapshotPublic)
def get_generation_job(
    job_id: int,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> AIJobWithBatchSnapshotPublic:
    job = db.query(AIJob).filter(AIJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI job not found")
    return _serialize_job_with_snapshot(job)


@router.post("/jobs/{job_id}/cancel", response_model=AIJobWithBatchSnapshotPublic)
def cancel_generation_job(
    job_id: int,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> AIJobWithBatchSnapshotPublic:
    job = db.query(AIJob).filter(AIJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI job not found")

    if job.status not in {"pending", "running"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel a job with status '{job.status}'",
        )

    cancel_event = _CANCEL_FLAGS.setdefault(job_id, threading.Event())
    cancel_event.set()

    batch_id = (job.metadata_json or {}).get("batch_id")
    if batch_id:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if api_key:
            try:
                anthropic.Anthropic(api_key=api_key).beta.messages.batches.cancel(batch_id)
            except Exception:
                pass

    _mark_job_cancelled(db, job)
    db.refresh(job)
    return _serialize_job_with_snapshot(job)


@router.get("/summary", response_model=GenerationSummaryResponse)
def get_generation_summary(
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> GenerationSummaryResponse:
    total_jobs = int(db.query(func.count(AIJob.id)).scalar() or 0)
    total_verses_generated = int(db.query(func.coalesce(func.sum(AIJob.processed_nodes), 0)).scalar() or 0)
    total_cost_usd = float(db.query(func.coalesce(func.sum(AIJob.actual_cost_usd), 0)).scalar() or 0.0)
    projected_total_cost_usd = float(
        db.query(
            func.coalesce(
                func.sum(
                    case(
                        (AIJob.status == "completed", func.coalesce(AIJob.actual_cost_usd, 0)),
                        else_=func.coalesce(AIJob.estimated_cost_usd, 0),
                    )
                ),
                0,
            )
        ).scalar()
        or 0.0
    )

    running_count = int(db.query(func.count(AIJob.id)).filter(AIJob.status == "running").scalar() or 0)
    completed_count = int(db.query(func.count(AIJob.id)).filter(AIJob.status == "completed").scalar() or 0)
    failed_count = int(db.query(func.count(AIJob.id)).filter(AIJob.status == "failed").scalar() or 0)

    cost_by_book_rows = (
        db.query(
            Book.book_name,
            func.coalesce(func.sum(AIJob.actual_cost_usd), 0),
            func.coalesce(func.sum(AIJob.processed_nodes), 0),
        )
        .join(Book, Book.id == AIJob.book_id)
        .group_by(Book.book_name)
        .order_by(func.sum(AIJob.processed_nodes).desc())
        .all()
    )
    cost_by_book = [
        BookCostSummary(
            book_name=str(book_name),
            total_cost=float(total_cost or 0.0),
            verses_generated=int(verses_generated or 0),
        )
        for book_name, total_cost, verses_generated in cost_by_book_rows
    ]

    language_rows = (
        db.query(
            AIJob.language_code,
            func.coalesce(func.sum(AIJob.processed_nodes), 0),
        )
        .filter(AIJob.language_code.isnot(None))
        .group_by(AIJob.language_code)
        .order_by(func.sum(AIJob.processed_nodes).desc())
        .all()
    )
    languages_covered = [
        LanguageCoverageSummary(language_code=str(code), verse_count=int(count or 0))
        for code, count in language_rows
    ]

    return GenerationSummaryResponse(
        total_jobs=total_jobs,
        total_verses_generated=total_verses_generated,
        total_cost_usd=round(total_cost_usd, 4),
        projected_total_cost_usd=round(projected_total_cost_usd, 4),
        jobs_by_status={
            "running": running_count,
            "completed": completed_count,
            "failed": failed_count,
        },
        cost_by_book=cost_by_book,
        languages_covered=languages_covered,
    )
