print("SCRIPT STARTED")

import argparse
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

print("STEP 1: stdlib imports done")

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
print("STEP 2: dotenv loaded")

import anthropic

print("STEP 3: anthropic imported")

from sqlalchemy.orm import Session

print("STEP 4: sqlalchemy imported")

from models.ai_job import AIJob
from models.book import Book
from models.commentary_author import CommentaryAuthor
from models.commentary_entry import CommentaryEntry
from models.commentary_work import CommentaryWork
from models.content_node import ContentNode
from models.database import SessionLocal
from models.provenance_record import ProvenanceRecord
from models.translation_author import TranslationAuthor
from models.translation_entry import TranslationEntry
from models.translation_work import TranslationWork

print("STEP 5: models imported")


DEFAULT_MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-5")
JOB_TYPE = "commentary_generation"

_LANG_CODE_TO_KEY: dict[str, str] = {
	"en": "en",
	"te": "te",
	"hi": "hi",
	"ta": "ta",
	"kn": "kn",
	"ml": "ml",
	"sa": "sa",
}

_HSP_AI_TRANSLATION_LANGUAGES: list[tuple[str, str]] = [
	("en", "English"),
	("te", "Telugu"),
	("hi", "Hindi"),
	("ta", "Tamil"),
]


SAVE_SHLOKA_CONTENT_TOOL: anthropic.types.ToolParam = {
	"name": "save_shloka_content",
	"description": (
		"Save the generated translation and commentary for a single shloka. "
		"Always call this tool with your complete output."
	),
	"input_schema": {
		"type": "object",
		"properties": {
			"translation": {
				"type": "string",
				"description": (
					"A clear, faithful translation of the shloka into the target language. "
					"Plain prose, no markdown."
				),
			},
			"commentary": {
				"type": "string",
				"description": (
					"A concise explanatory commentary (2-4 sentences) illuminating the meaning "
					"and significance of the shloka. Plain prose, no markdown."
				),
			},
		},
		"required": ["translation", "commentary"],
	},
}


def _get_db() -> Session:
	return SessionLocal()


def _resolve_book(db: Session, book_code: str) -> Book:
	book = db.query(Book).filter(Book.book_code == book_code).first()
	if not book:
		print(f"[ERROR] Book not found: {book_code!r}", file=sys.stderr)
		sys.exit(1)
	return book


def _resolve_hsp_ai_author(db: Session) -> CommentaryAuthor:
	author = db.query(CommentaryAuthor).filter(CommentaryAuthor.name == "HSP AI").first()
	if not author:
		print(
			"[ERROR] 'HSP AI' commentary author not found. Run the seed script first.",
			file=sys.stderr,
		)
		sys.exit(1)
	return author


def _resolve_commentary_work(
	db: Session, author: CommentaryAuthor, language_name: str
) -> CommentaryWork:
	title = f"HSP AI Commentary - {language_name}"
	work = (
		db.query(CommentaryWork)
		.filter(
			CommentaryWork.author_id == author.id,
			CommentaryWork.title == title,
		)
		.first()
	)
	if not work:
		print(f"[ERROR] Commentary work not found: {title!r}", file=sys.stderr)
		sys.exit(1)
	return work


def _resolve_hsp_ai_translation_author(db: Session) -> TranslationAuthor:
	author = db.query(TranslationAuthor).filter(TranslationAuthor.name == "HSP AI").first()
	if author:
		return author

	author = TranslationAuthor(
		name="HSP AI",
		bio="AI-generated translations on behalf of the Hindu Scriptures Platform.",
		metadata_json={
			"type": "ai",
			"provider": "anthropic",
			"model": DEFAULT_MODEL,
		},
	)
	db.add(author)
	db.flush()
	return author


def _resolve_or_create_translation_work(
	db: Session,
	author: TranslationAuthor,
	language_name: str,
	language_code: str,
) -> TranslationWork:
	title = f"HSP AI Translation - {language_name}"
	work = (
		db.query(TranslationWork)
		.filter(
			TranslationWork.author_id == author.id,
			TranslationWork.title == title,
		)
		.first()
	)
	if work:
		return work

	work = TranslationWork(
		author_id=author.id,
		title=title,
		description=f"AI-generated {language_name} translation for supported scripture nodes.",
		metadata_json={
			"type": "ai_translation",
			"language_code": language_code,
			"language_name": language_name.lower(),
			"model": DEFAULT_MODEL,
		},
	)
	db.add(work)
	db.flush()
	return work


def _seed_hsp_ai_translation_works(db: Session, author: TranslationAuthor) -> None:
	for code, name in _HSP_AI_TRANSLATION_LANGUAGES:
		_resolve_or_create_translation_work(db, author, name, code)


def _fetch_nodes_missing_translation(
	db: Session,
	book: Book,
	language_code: str,
	translation_work_id: int,
	limit: int,
) -> list[ContentNode]:
	nodes = (
		db.query(ContentNode)
		.filter(
			ContentNode.book_id == book.id,
			ContentNode.has_content == True,
		)
		.order_by(ContentNode.level_order, ContentNode.id)
		.limit(limit * 10)
		.all()
	)

	missing: list[ContentNode] = []
	for node in nodes:
		if len(missing) >= limit:
			break
		existing_translation = (
			db.query(TranslationEntry.id)
			.filter(
				TranslationEntry.node_id == node.id,
				TranslationEntry.work_id == translation_work_id,
				TranslationEntry.language_code == language_code,
			)
			.first()
		)
		if existing_translation:
			continue
		missing.append(node)

	return missing


def _build_source_text(node: ContentNode) -> str:
	cd = node.content_data or {}
	basic = cd.get("basic") or {}

	parts: list[str] = []
	seq = node.sequence_number or ""
	if seq:
		parts.append(f"Verse {seq}")

	for key in ("sanskrit", "devanagari", "text", "verse", "source"):
		val = basic.get(key) or cd.get(key)
		if isinstance(val, str) and val.strip():
			parts.append(f"Sanskrit: {val.strip()}")
			break

	for key in ("transliteration", "iast", "roman"):
		val = basic.get(key) or cd.get(key)
		if isinstance(val, str) and val.strip():
			parts.append(f"Transliteration: {val.strip()}")
			break

	if existing := (cd.get("basic") or {}).get("translation"):
		parts.append(f"Existing English translation (for reference): {existing}")

	return "\n".join(parts) if parts else "(source text unavailable)"


def _call_claude(
	client: anthropic.Anthropic,
	model: str,
	book_name: str,
	node: ContentNode,
	language_name: str,
	language_code: str,
) -> tuple[str, str] | None:
	source_text = _build_source_text(node)
	seq = node.sequence_number or f"node-{node.id}"

	system_prompt = (
		f"You are a learned scholar of Hindu scriptures producing high-quality {language_name} "
		f"translations and commentary for the {book_name}. "
		"Your outputs will be reviewed by human editors before publication. "
		"Be faithful to the source, clear in expression, and reverent in tone. "
		"Always respond by calling the save_shloka_content tool."
	)

	user_message = (
		f"Generate a {language_name} translation and brief commentary for verse {seq} "
		f"of the {book_name}.\n\n{source_text}"
	)

	response = client.messages.create(
		model=model,
		max_tokens=1024,
		tools=[SAVE_SHLOKA_CONTENT_TOOL],
		tool_choice={"type": "tool", "name": "save_shloka_content"},
		system=system_prompt,
		messages=[{"role": "user", "content": user_message}],
	)

	for block in response.content:
		if block.type == "tool_use" and block.name == "save_shloka_content":
			inp = block.input
			translation = (inp.get("translation") or "").strip()
			commentary = (inp.get("commentary") or "").strip()
			if translation:
				return translation, commentary

	return None


def _write_results(
	db: Session,
	node: ContentNode,
	translation: str,
	commentary: str,
	language_code: str,
	translation_work: TranslationWork,
	translation_author: TranslationAuthor,
	work: CommentaryWork,
	author: CommentaryAuthor,
	ai_job_id: int,
	model: str,
) -> None:
	translation_metadata = {
		"ai_job_id": ai_job_id,
		"model": model,
		"generated_at": datetime.now(tz=timezone.utc).isoformat(),
	}

	existing_translation_entry = (
		db.query(TranslationEntry)
		.filter(
			TranslationEntry.node_id == node.id,
			TranslationEntry.work_id == translation_work.id,
			TranslationEntry.language_code == language_code,
		)
		.first()
	)
	if existing_translation_entry:
		existing_translation_entry.content_text = translation
		existing_translation_entry.metadata_json = translation_metadata
	else:
		translation_entry = TranslationEntry(
			node_id=node.id,
			author_id=translation_author.id,
			work_id=translation_work.id,
			content_text=translation,
			language_code=language_code,
			display_order=0,
			metadata_json=translation_metadata,
		)
		db.add(translation_entry)

	existing_entry = (
		db.query(CommentaryEntry)
		.filter(
			CommentaryEntry.node_id == node.id,
			CommentaryEntry.work_id == work.id,
			CommentaryEntry.language_code == language_code,
		)
		.first()
	)
	if existing_entry:
		existing_entry.content_text = commentary
		existing_entry.metadata_json = {
			"ai_job_id": ai_job_id,
			"model": model,
			"generated_at": datetime.now(tz=timezone.utc).isoformat(),
		}
	else:
		entry = CommentaryEntry(
			node_id=node.id,
			author_id=author.id,
			work_id=work.id,
			content_text=commentary,
			language_code=language_code,
			display_order=0,
			metadata_json={
				"ai_job_id": ai_job_id,
				"model": model,
				"generated_at": datetime.now(tz=timezone.utc).isoformat(),
			},
		)
		db.add(entry)

	prov = ProvenanceRecord(
		target_book_id=node.book_id,
		target_node_id=node.id,
		source_type="ai_generated",
		source_author=f"HSP AI ({model})",
		license_type="CC-BY-SA-4.0",
		source_version=model,
	)
	db.add(prov)
	db.flush()


def _create_ai_job(
	db: Session,
	book: Book,
	language_code: str,
	model: str,
	total_nodes: int,
) -> AIJob:
	job = AIJob(
		job_type=JOB_TYPE,
		book_id=book.id,
		language_code=language_code,
		model=model,
		status="running",
		total_nodes=total_nodes,
		processed_nodes=0,
		failed_nodes=0,
		metadata_json={"book_code": book.book_code},
		started_at=datetime.now(tz=timezone.utc),
	)
	db.add(job)
	db.commit()
	db.refresh(job)
	return job


def _update_job_progress(
	db: Session,
	job: AIJob,
	processed: int,
	failed: int,
) -> None:
	job.processed_nodes = processed
	job.failed_nodes = failed
	db.commit()


def _finish_job(
	db: Session,
	job: AIJob,
	processed: int,
	failed: int,
	error_log: list[dict],
) -> None:
	job.processed_nodes = processed
	job.failed_nodes = failed
	job.status = "completed"
	job.completed_at = datetime.now(tz=timezone.utc)
	if error_log:
		job.error_log = error_log
	db.commit()


def _parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Generate AI translations and commentary for scripture nodes."
	)
	parser.add_argument("--book-code", required=True, help="e.g. avadhuta-gita")
	parser.add_argument("--language-code", required=True, help="e.g. en, te, hi, ta")
	parser.add_argument("--language-name", required=True, help="e.g. English, Telugu")
	parser.add_argument(
		"--limit",
		type=int,
		default=5,
		help="Max nodes to process (default: 5 for testing)",
	)
	return parser.parse_args()


def main() -> None:
	print("MAIN STARTED")
	args = _parse_args()
	print(f"ARGS: {args}")

	api_key = os.getenv("ANTHROPIC_API_KEY")
	print(f"API KEY: {'found' if api_key else 'NOT FOUND'}")
	if not api_key:
		print("[ERROR] ANTHROPIC_API_KEY not set in environment or .env", file=sys.stderr)
		sys.exit(1)

	model = DEFAULT_MODEL
	print(f"MODEL: {model}")

	client = anthropic.Anthropic(api_key=api_key)
	print("CLIENT CREATED")

	db = _get_db()
	print("DB CONNECTED")
	try:
		book = _resolve_book(db, args.book_code)
		print(f"BOOK: {book.book_name}")

		author = _resolve_hsp_ai_author(db)
		print(f"AUTHOR: {author.name}")

		work = _resolve_commentary_work(db, author, args.language_name)
		print(f"WORK: {work.title}")

		translation_author = _resolve_hsp_ai_translation_author(db)
		_seed_hsp_ai_translation_works(db, translation_author)
		translation_work = _resolve_or_create_translation_work(
			db,
			translation_author,
			args.language_name,
			args.language_code,
		)
		db.commit()
		print(f"TRANSLATION WORK: {translation_work.title}")

		nodes = _fetch_nodes_missing_translation(
			db,
			book,
			args.language_code,
			translation_work.id,
			args.limit,
		)
		print(f"NODES TO PROCESS: {len(nodes)}")

		if not nodes:
			print(
				f"[INFO] No nodes missing '{args.language_code}' translation "
				f"for book '{args.book_code}'. Nothing to do."
			)
			return

		job = _create_ai_job(db, book, args.language_code, model, total_nodes=len(nodes))
		print(f"AI JOB CREATED: id={job.id}")

		processed = 0
		failed = 0
		error_log: list[dict] = []

		for i, node in enumerate(nodes, 1):
			seq = node.sequence_number or f"node-{node.id}"
			print(f"PROCESS START [{i}/{len(nodes)}]: node={node.id} seq={seq}")
			try:
				result = _call_claude(
					client=client,
					model=model,
					book_name=book.book_name,
					node=node,
					language_name=args.language_name,
					language_code=args.language_code,
				)
				print("CLAUDE CALL DONE")
				if result is None:
					raise ValueError("Claude did not return a tool_use block")

				translation, commentary = result
				print(f"TRANSLATION RECEIVED: {translation[:80]}{'...' if len(translation) > 80 else ''}")

				_write_results(
					db=db,
					node=node,
					translation=translation,
					commentary=commentary,
					language_code=args.language_code,
					translation_work=translation_work,
					translation_author=translation_author,
					work=work,
					author=author,
					ai_job_id=job.id,
					model=model,
				)
				db.commit()
				processed += 1
				print("NODE SAVE DONE")

			except Exception as exc:  # noqa: BLE001
				db.rollback()
				failed += 1
				err_detail = {
					"node_id": node.id,
					"sequence_number": seq,
					"error": str(exc),
				}
				error_log.append(err_detail)
				print(f"NODE FAILED: {exc}")
				traceback.print_exc()

			_update_job_progress(db, job, processed, failed)
			print(f"JOB PROGRESS UPDATED: processed={processed}, failed={failed}")

		_finish_job(db, job, processed, failed, error_log)
		print(f"JOB FINISHED: id={job.id}, processed={processed}, failed={failed}")

		print(
			f"\n[DONE] Job id={job.id}: {processed} processed, {failed} failed "
			f"out of {len(nodes)} nodes."
		)
		if error_log:
			print("[ERRORS]")
			for err in error_log:
				print(f"  node_id={err['node_id']} seq={err['sequence_number']}: {err['error']}")

	finally:
		db.close()
		print("DB CLOSED")


if __name__ == "__main__":
	main()
