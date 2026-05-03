"""AI Jobs API — create, list, retrieve, and update AI generation jobs."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api.users import get_current_user, require_permission
from models.ai_job import AIJob
from models.book import Book
from models.schemas import AIJobCreate, AIJobPublic, AIJobStatusUpdate
from models.user import User
from services import get_db

router = APIRouter(prefix="/ai-jobs", tags=["ai-jobs"])


def _serialize(job: AIJob) -> AIJobPublic:
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


@router.post("", response_model=AIJobPublic, status_code=status.HTTP_201_CREATED)
def create_ai_job(
    payload: AIJobCreate,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> AIJobPublic:
    """Create a new AI generation job. Requires can_admin permission."""
    book = db.query(Book).filter(Book.id == payload.book_id).first()
    if not book:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Book not found")

    job = AIJob(
        job_type=payload.job_type,
        book_id=payload.book_id,
        language_code=payload.language_code,
        model=payload.model,
        status="pending",
        metadata_json=payload.metadata or {},
        created_by=current_user.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _serialize(job)


@router.get("", response_model=list[AIJobPublic])
def list_ai_jobs(
    book_id: int | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> list[AIJobPublic]:
    """List AI jobs with optional filters. Requires can_admin permission."""
    query = db.query(AIJob)
    if book_id is not None:
        query = query.filter(AIJob.book_id == book_id)
    if status is not None:
        query = query.filter(AIJob.status == status)
    jobs = query.order_by(AIJob.created_at.desc()).offset(offset).limit(limit).all()
    return [_serialize(j) for j in jobs]


@router.get("/{job_id}", response_model=AIJobPublic)
def get_ai_job(
    job_id: int,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> AIJobPublic:
    """Retrieve a single AI job by ID. Requires can_admin permission."""
    job = db.query(AIJob).filter(AIJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI job not found")
    return _serialize(job)


@router.patch("/{job_id}", response_model=AIJobPublic)
def update_ai_job_status(
    job_id: int,
    payload: AIJobStatusUpdate,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> AIJobPublic:
    """Update job status and progress fields. Requires can_admin permission."""
    job = db.query(AIJob).filter(AIJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI job not found")

    now = datetime.now(tz=timezone.utc)

    job.status = payload.status
    if payload.processed_nodes is not None:
        job.processed_nodes = payload.processed_nodes
    if payload.failed_nodes is not None:
        job.failed_nodes = payload.failed_nodes
    if payload.actual_cost_usd is not None:
        job.actual_cost_usd = payload.actual_cost_usd
    if payload.error_log is not None:
        job.error_log = payload.error_log

    if payload.status == "running" and job.started_at is None:
        job.started_at = now
    if payload.status in ("completed", "failed", "cancelled"):
        job.completed_at = now

    db.commit()
    db.refresh(job)
    return _serialize(job)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_ai_job(
    job_id: int,
    current_user: User = Depends(require_permission("can_admin")),
    db: Session = Depends(get_db),
) -> None:
    """Cancel a pending or running AI job. Requires can_admin permission."""
    job = db.query(AIJob).filter(AIJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI job not found")
    if job.status not in ("pending", "running"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel a job with status '{job.status}'",
        )
    job.status = "cancelled"
    job.completed_at = datetime.now(tz=timezone.utc)
    db.commit()
