import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import anthropic

from sqlalchemy import or_
from sqlalchemy.orm import aliased
from sqlalchemy.orm import Session

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
from models.word_meaning_author import WordMeaningAuthor
from models.word_meaning_entry import WordMeaningEntry
from models.word_meaning_work import WordMeaningWork


DEFAULT_MODEL = os.getenv("AI_MODEL", "claude-sonnet-4-5")
JOB_TYPE = "commentary_generation"

# Default token pricing (USD per 1M tokens). Override via env vars if needed.
AI_INPUT_COST_PER_MTOK = float(os.getenv("AI_INPUT_COST_PER_MTOK", "3.0"))
AI_OUTPUT_COST_PER_MTOK = float(os.getenv("AI_OUTPUT_COST_PER_MTOK", "15.0"))
BATCH_POLL_INTERVAL_SECONDS = int(os.getenv("ANTHROPIC_BATCH_POLL_INTERVAL_SECONDS", "30"))
BATCH_MAX_WAIT_SECONDS = int(os.getenv("ANTHROPIC_BATCH_MAX_WAIT_SECONDS", str(24 * 60 * 60)))

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

_LANGUAGE_NAMES_BY_CODE: dict[str, str] = {
	"en": "English",
	"te": "Telugu",
	"hi": "Hindi",
	"ta": "Tamil",
	"kn": "Kannada",
	"ml": "Malayalam",
	"sa": "Sanskrit",
}


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
			"word_meanings": {
				"type": "string",
				"description": (
					"Semicolon-separated word-by-word meanings in format: "
					"sanskrit_word=meaning; sanskrit_word=meaning; ... "
					"Example: dharma-ksetre=in the field of dharma; "
					"kuru-ksetre=on the battlefield of Kurukshetra;"
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
	if author:
		return author

	author = CommentaryAuthor(
		name="HSP AI",
		bio="AI-generated commentary on behalf of the Hindu Scriptures Platform.",
		metadata_json={
			"type": "ai",
			"provider": "anthropic",
			"model": DEFAULT_MODEL,
		},
	)
	db.add(author)
	db.flush()
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
	if work:
		return work

	work = CommentaryWork(
		author_id=author.id,
		title=title,
		description=f"AI-generated commentary for supported scripture nodes.",
		metadata_json={
			"type": "ai_commentary",
			"language_name": language_name.lower(),
			"model": DEFAULT_MODEL,
		},
	)
	db.add(work)
	db.flush()
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


def _resolve_hsp_ai_word_meaning_author(db: Session) -> WordMeaningAuthor:
	author = db.query(WordMeaningAuthor).filter(WordMeaningAuthor.name == "HSP AI").first()
	if author:
		return author

	author = WordMeaningAuthor(
		name="HSP AI",
		bio="AI-generated word meanings on behalf of the Hindu Scriptures Platform.",
		metadata_json={
			"type": "ai",
			"provider": "anthropic",
			"model": DEFAULT_MODEL,
		},
	)
	db.add(author)
	db.flush()
	return author


def _resolve_or_create_word_meaning_work(
	db: Session,
	author: WordMeaningAuthor,
	language_name: str,
	language_code: str,
) -> WordMeaningWork:
	title = f"HSP AI Word Meanings - {language_name}"
	work = (
		db.query(WordMeaningWork)
		.filter(
			WordMeaningWork.author_id == author.id,
			WordMeaningWork.title == title,
		)
		.first()
	)
	if work:
		return work

	work = WordMeaningWork(
		author_id=author.id,
		title=title,
		description=f"AI-generated {language_name} word meanings for supported scripture nodes.",
		metadata_json={
			"type": "ai_word_meanings",
			"language_code": language_code,
			"language_name": language_name.lower(),
			"model": DEFAULT_MODEL,
		},
	)
	db.add(work)
	db.flush()
	return work


def _fetch_nodes_missing_translation(
	db: Session,
	book: Book,
	language_code: str,
	translation_work_id: int,
	limit: int | None,
) -> list[ContentNode]:
	ref_node = aliased(ContentNode)
	query = (
		db.query(ContentNode, ref_node)
		.outerjoin(ref_node, ContentNode.referenced_node_id == ref_node.id)
		.filter(
			ContentNode.book_id == book.id,
			or_(
				ContentNode.has_content == True,
				ContentNode.referenced_node_id.isnot(None),
			),
		)
		.order_by(ContentNode.level_order, ContentNode.id)
	)
	if limit is not None:
		query = query.limit(limit * 10)
	node_pairs = query.all()

	missing: list[ContentNode] = []
	seen_node_ids: set[int] = set()
	for owner_node, referenced_node in node_pairs:
		target_node: ContentNode | None = None
		if referenced_node is not None:
			target_node = referenced_node
		elif owner_node.has_content:
			target_node = owner_node

		if target_node is None:
			continue
		if target_node.id in seen_node_ids:
			continue

		if limit is not None and len(missing) >= limit:
			break
		existing_translation = (
			db.query(TranslationEntry.id)
			.filter(
				TranslationEntry.node_id == target_node.id,
				TranslationEntry.work_id == translation_work_id,
				TranslationEntry.language_code == language_code,
			)
			.first()
		)
		if existing_translation:
			seen_node_ids.add(target_node.id)
			continue
		missing.append(target_node)
		seen_node_ids.add(target_node.id)

	return missing


def _fetch_nodes_for_node_ids(
	db: Session,
	node_ids: list[int],
	language_code: str,
	translation_work_id: int,
	limit: int | None,
) -> list[ContentNode]:
	"""Fetch ContentNodes by explicit IDs, resolve references, filter to those missing translation."""
	if not node_ids:
		return []

	ref_node = aliased(ContentNode)
	query = (
		db.query(ContentNode, ref_node)
		.outerjoin(ref_node, ContentNode.referenced_node_id == ref_node.id)
		.filter(ContentNode.id.in_(node_ids))
		.order_by(ContentNode.level_order, ContentNode.id)
	)
	node_pairs = query.all()

	missing: list[ContentNode] = []
	seen_node_ids: set[int] = set()
	for owner_node, referenced_node in node_pairs:
		target_node: ContentNode | None = None
		if referenced_node is not None:
			target_node = referenced_node
		elif owner_node.has_content:
			target_node = owner_node

		if target_node is None:
			continue
		if target_node.id in seen_node_ids:
			continue

		if limit is not None and len(missing) >= limit:
			break

		existing_translation = (
			db.query(TranslationEntry.id)
			.filter(
				TranslationEntry.node_id == target_node.id,
				TranslationEntry.work_id == translation_work_id,
				TranslationEntry.language_code == language_code,
			)
			.first()
		)
		if existing_translation:
			seen_node_ids.add(target_node.id)
			continue
		missing.append(target_node)
		seen_node_ids.add(target_node.id)

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


def _build_generation_prompts(
	book_name: str,
	node: ContentNode,
	language_name: str,
	additional_instructions: str | None = None,
) -> tuple[str, str, str]:
	source_text = _build_source_text(node)
	seq = node.sequence_number or f"node-{node.id}"
	instructions_block = (
		f"Additional instructions: {additional_instructions.strip()} "
		if isinstance(additional_instructions, str) and additional_instructions.strip()
		else ""
	)

	system_prompt = (
		f"You are a learned scholar of Hindu scriptures producing high-quality {language_name} "
		f"translations and commentary for the {book_name}. "
		f"{instructions_block}"
		"Your outputs will be reviewed by human editors before publication. "
		"Be faithful to the source, clear in expression, and reverent in tone. "
		"Always respond by calling the save_shloka_content tool."
	)

	user_message = (
		f"Generate a {language_name} translation and brief commentary for verse {seq} "
		f"of the {book_name}.\n\n{source_text}"
	)

	return system_prompt, user_message, source_text


def _extract_tool_result_from_content(content_blocks) -> tuple[str, str, str] | None:
	for block in content_blocks or []:
		if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "save_shloka_content":
			inp = getattr(block, "input", {}) or {}
			translation = (inp.get("translation") or "").strip()
			commentary = (inp.get("commentary") or "").strip()
			word_meanings = (inp.get("word_meanings") or "").strip()
			if translation:
				return translation, commentary, word_meanings

		if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "save_shloka_content":
			inp = block.get("input") or {}
			translation = (inp.get("translation") or "").strip()
			commentary = (inp.get("commentary") or "").strip()
			word_meanings = (inp.get("word_meanings") or "").strip()
			if translation:
				return translation, commentary, word_meanings

	return None


def _parse_word_meanings(token_string: str, language_code: str) -> dict:
	rows = []
	for i, token in enumerate(token_string.split(";")):
		token = token.strip()
		if "=" not in token:
			continue
		sanskrit, meaning = token.split("=", 1)
		sanskrit = sanskrit.strip()
		meaning = meaning.strip()
		if not sanskrit or not meaning:
			continue
		rows.append(
			{
				"id": f"wm_{language_code}_{i}",
				"order": i + 1,
				"source": {
					"language": "sa",
					"script_text": sanskrit,
					"transliteration": {"iast": sanskrit},
				},
				"meanings": {
					language_code: {"text": meaning},
				},
			}
		)
	return {"rows": rows}


def _obj_get(value, key: str, default=None):
	if isinstance(value, dict):
		return value.get(key, default)
	return getattr(value, key, default)


def _estimate_cost(nodes: list[ContentNode]) -> tuple[float, float]:
	# Rough estimation: ~4 chars/token and fixed output cap per request.
	total_input_tokens = 0
	total_output_tokens = len(nodes) * 1024

	for node in nodes:
		source_text = _build_source_text(node)
		total_input_tokens += max(200, int(len(source_text) / 4) + 300)

	realtime_cost = (
		(total_input_tokens / 1_000_000.0) * AI_INPUT_COST_PER_MTOK
		+ (total_output_tokens / 1_000_000.0) * AI_OUTPUT_COST_PER_MTOK
	)
	batch_cost = realtime_cost * 0.5
	return realtime_cost, batch_cost


def _submit_batch(
	client: anthropic.Anthropic,
	model: str,
	book_name: str,
	nodes: list[ContentNode],
	language_name: str,
	additional_instructions: str | None = None,
) -> str:
	batch_requests = []
	for node in nodes:
		system_prompt, user_message, _ = _build_generation_prompts(
			book_name,
			node,
			language_name,
			additional_instructions,
		)
		batch_requests.append(
			{
				"custom_id": str(node.id),
				"params": {
					"model": model,
					"max_tokens": 1024,
					"tools": [SAVE_SHLOKA_CONTENT_TOOL],
					"tool_choice": {"type": "tool", "name": "save_shloka_content"},
					"system": system_prompt,
					"messages": [{"role": "user", "content": user_message}],
				},
			}
		)

	batch = client.beta.messages.batches.create(requests=batch_requests)
	batch_id = _obj_get(batch, "id")
	if not batch_id:
		raise RuntimeError("Anthropic batch create did not return a batch id")
	return str(batch_id)


def _fmt_elapsed(seconds: float) -> str:
	m, s = divmod(int(seconds), 60)
	return f"{m}m {s:02d}s"


def _poll_batch_until_complete(client: anthropic.Anthropic, batch_id: str) -> None:
	started = datetime.now(tz=timezone.utc)
	prev_completed = 0
	rate_started: float | None = None  # seconds elapsed when first progress was seen

	while True:
		status_obj = client.beta.messages.batches.retrieve(batch_id)
		status = _obj_get(status_obj, "processing_status") or _obj_get(status_obj, "status")
		status_text = str(status or "unknown")

		elapsed = (datetime.now(tz=timezone.utc) - started).total_seconds()
		elapsed_str = _fmt_elapsed(elapsed)

		# Parse request_counts from batch object
		counts = _obj_get(status_obj, "request_counts")
		total: int | None = None
		completed: int | None = None
		if counts is not None:
			succeeded = _obj_get(counts, "succeeded") or 0
			errored = _obj_get(counts, "errored") or 0
			processing = _obj_get(counts, "processing") or 0
			canceled = _obj_get(counts, "canceled") or 0
			expired = _obj_get(counts, "expired") or 0
			completed = int(succeeded) + int(errored) + int(canceled) + int(expired)
			total = completed + int(processing)

		# Build status suffix
		if total is not None and total > 0:
			if completed and completed > prev_completed and rate_started is None:
				rate_started = elapsed
			if rate_started is not None and completed and completed > 0 and elapsed > rate_started:
				rate = completed / (elapsed - rate_started)  # requests per second
				remaining = (total - completed) / rate if rate > 0 else None
				est_str = _fmt_elapsed(remaining) if remaining is not None else "unknown"
			else:
				est_str = "unknown"
			prev_completed = completed or 0
			suffix = f"requests completed={completed}/{total}, est. remaining={est_str}"
		else:
			suffix = "est. remaining=unknown"

		print(f"Polling... status={status_text}, elapsed={elapsed_str}, {suffix}")

		if status_text.lower() == "ended":
			return

		if status_text.lower() in {"canceled", "cancelled", "expired", "failed"}:
			raise RuntimeError(f"Batch did not complete successfully (status={status_text})")

		if elapsed > BATCH_MAX_WAIT_SECONDS:
			raise TimeoutError(
				f"Timed out waiting for batch completion after {int(elapsed)}s "
				f"(max={BATCH_MAX_WAIT_SECONDS}s)"
			)

		time.sleep(BATCH_POLL_INTERVAL_SECONDS)


def _collect_batch_results(
	client: anthropic.Anthropic,
	batch_id: str,
) -> tuple[dict[int, tuple[str, str, str]], dict[int, str]]:
	successes: dict[int, tuple[str, str, str]] = {}
	failures: dict[int, str] = {}

	for item in client.beta.messages.batches.results(batch_id):
		custom_id = _obj_get(item, "custom_id")
		try:
			node_id = int(str(custom_id))
		except Exception:  # noqa: BLE001
			continue

		result_obj = _obj_get(item, "result")
		result_type = str(_obj_get(result_obj, "type", "unknown"))
		if result_type != "succeeded":
			error_obj = _obj_get(result_obj, "error")
			error_msg = str(error_obj) if error_obj is not None else f"Result type={result_type}"
			failures[node_id] = error_msg
			continue

		message_obj = _obj_get(result_obj, "message")
		content_blocks = _obj_get(message_obj, "content", [])
		parsed = _extract_tool_result_from_content(content_blocks)
		if parsed is None:
			failures[node_id] = "No save_shloka_content tool result found"
			continue

		successes[node_id] = parsed

	return successes, failures


def _call_claude(
	client: anthropic.Anthropic,
	model: str,
	book_name: str,
	node: ContentNode,
	language_name: str,
	language_code: str,
	additional_instructions: str | None = None,
) -> tuple[str, str, str] | None:
	system_prompt, user_message, _ = _build_generation_prompts(
		book_name,
		node,
		language_name,
		additional_instructions,
	)

	response = client.messages.create(
		model=model,
		max_tokens=1024,
		tools=[SAVE_SHLOKA_CONTENT_TOOL],
		tool_choice={"type": "tool", "name": "save_shloka_content"},
		system=system_prompt,
		messages=[{"role": "user", "content": user_message}],
	)

	return _extract_tool_result_from_content(response.content)


def _write_results(
	db: Session,
	node: ContentNode,
	translation: str,
	commentary: str,
	word_meanings_token: str | None,
	language_code: str,
	translation_work: TranslationWork,
	translation_author: TranslationAuthor,
	work: CommentaryWork,
	author: CommentaryAuthor,
	word_meaning_work: WordMeaningWork,
	word_meaning_author: WordMeaningAuthor,
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

	if isinstance(word_meanings_token, str) and word_meanings_token.strip():
		parsed_word_meanings = _parse_word_meanings(word_meanings_token, language_code)
		parsed_rows = parsed_word_meanings.get("rows") if isinstance(parsed_word_meanings, dict) else []
		if isinstance(parsed_rows, list):
			for raw_row in parsed_rows:
				if not isinstance(raw_row, dict):
					continue
				source = raw_row.get("source") if isinstance(raw_row.get("source"), dict) else {}
				source_word = str(source.get("script_text") or "").strip()
				if not source_word:
					continue

				translit = source.get("transliteration") if isinstance(source.get("transliteration"), dict) else {}
				transliteration = str(translit.get("iast") or source_word).strip()
				word_order = int(raw_row.get("order") or 0)
				if word_order <= 0:
					continue

				meanings = raw_row.get("meanings") if isinstance(raw_row.get("meanings"), dict) else {}
				language_payload = meanings.get(language_code) if isinstance(meanings.get(language_code), dict) else {}
				meaning_text = str(language_payload.get("text") or "").strip()
				if not meaning_text:
					continue

				existing_word_entry = (
					db.query(WordMeaningEntry)
					.filter(
						WordMeaningEntry.node_id == node.id,
						WordMeaningEntry.word_order == word_order,
						WordMeaningEntry.language_code == language_code,
						WordMeaningEntry.author_id == word_meaning_author.id,
					)
					.first()
				)

				if existing_word_entry:
					existing_word_entry.source_word = source_word
					existing_word_entry.transliteration = transliteration
					existing_word_entry.meaning_text = meaning_text
					existing_word_entry.display_order = word_order - 1
					existing_word_entry.work_id = word_meaning_work.id
					existing_word_entry.metadata_json = {
						"ai_job_id": ai_job_id,
						"model": model,
						"generated_at": datetime.now(tz=timezone.utc).isoformat(),
					}
				else:
					word_entry = WordMeaningEntry(
						node_id=node.id,
						author_id=word_meaning_author.id,
						work_id=word_meaning_work.id,
						source_word=source_word,
						transliteration=transliteration,
						word_order=word_order,
						language_code=language_code,
						meaning_text=meaning_text,
						display_order=word_order - 1,
						metadata_json={
							"ai_job_id": ai_job_id,
							"model": model,
							"generated_at": datetime.now(tz=timezone.utc).isoformat(),
						},
					)
					db.add(word_entry)

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
	parser.add_argument(
		"--batch",
		action="store_true",
		help="Use Anthropic Batch API mode (submit all selected nodes as one batch job).",
	)
	parser.add_argument(
		"--instructions",
		type=str,
		default=None,
		help="Optional additional instructions to guide generation (max 500 chars).",
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

	additional_instructions = (args.instructions or "").strip() or None
	if additional_instructions is not None and len(additional_instructions) > 500:
		print("[ERROR] --instructions must be 500 characters or fewer", file=sys.stderr)
		sys.exit(1)

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
		word_meaning_author = _resolve_hsp_ai_word_meaning_author(db)
		resolved_language_name = _LANGUAGE_NAMES_BY_CODE.get(args.language_code, args.language_name)
		word_meaning_work = _resolve_or_create_word_meaning_work(
			db,
			word_meaning_author,
			resolved_language_name,
			args.language_code,
		)
		db.commit()
		print(f"TRANSLATION WORK: {translation_work.title}")
		print(f"WORD MEANING WORK: {word_meaning_work.title}")

		nodes = _fetch_nodes_missing_translation(
			db,
			book,
			args.language_code,
			translation_work.id,
			args.limit,
		)
		print(f"NODES TO PROCESS: {len(nodes)}")

		realtime_cost, batch_cost = _estimate_cost(nodes)
		print(f"Real-time cost estimate: ${realtime_cost:.2f}")
		print(f"Batch cost estimate: ${batch_cost:.2f} (50% savings)")

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

		if args.batch:
			print("MODE: batch (Anthropic Batch API)")
			try:
				batch_id = _submit_batch(
					client=client,
					model=model,
					book_name=book.book_name,
					nodes=nodes,
					language_name=args.language_name,
					additional_instructions=additional_instructions,
				)
				print(f"Batch submitted. ID: {batch_id}")
				print("Polling for completion (batch jobs can take up to 24 hours)...")
				_poll_batch_until_complete(client, batch_id)
				print("Batch complete! Processing results...")

				batch_successes, batch_failures = _collect_batch_results(client, batch_id)

				for i, node in enumerate(nodes, 1):
					seq = node.sequence_number or f"node-{node.id}"
					print(f"PROCESS RESULT [{i}/{len(nodes)}]: node={node.id} seq={seq}")
					try:
						if node.id in batch_successes:
							translation, commentary, word_meanings_token = batch_successes[node.id]
							_write_results(
								db=db,
								node=node,
								translation=translation,
								commentary=commentary,
								word_meanings_token=word_meanings_token,
								language_code=args.language_code,
								translation_work=translation_work,
								translation_author=translation_author,
								work=work,
								author=author,
								word_meaning_work=word_meaning_work,
								word_meaning_author=word_meaning_author,
								ai_job_id=job.id,
								model=model,
							)
							db.commit()
							processed += 1
							print("NODE SAVE DONE")
						else:
							raise ValueError(batch_failures.get(node.id, "No result returned for node"))

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

					_update_job_progress(db, job, processed, failed)
					print(f"JOB PROGRESS UPDATED: processed={processed}, failed={failed}")

			except Exception as exc:  # noqa: BLE001
				db.rollback()
				failed = len(nodes)
				error_log.append({"node_id": None, "sequence_number": None, "error": str(exc)})
				print(f"BATCH MODE FAILED: {exc}")
				traceback.print_exc()
				_update_job_progress(db, job, processed, failed)

		else:
			print("MODE: real-time")
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
						additional_instructions=additional_instructions,
					)
					print("CLAUDE CALL DONE")
					if result is None:
						raise ValueError("Claude did not return a tool_use block")

					translation, commentary, word_meanings_token = result
					print(f"TRANSLATION RECEIVED: {translation[:80]}{'...' if len(translation) > 80 else ''}")

					_write_results(
						db=db,
						node=node,
						translation=translation,
						commentary=commentary,
						word_meanings_token=word_meanings_token,
						language_code=args.language_code,
						translation_work=translation_work,
						translation_author=translation_author,
						work=work,
						author=author,
						word_meaning_work=word_meaning_work,
						word_meaning_author=word_meaning_author,
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
