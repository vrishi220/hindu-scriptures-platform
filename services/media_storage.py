import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

from fastapi import UploadFile


class FileTooLargeError(Exception):
    pass


class UnsupportedMediaStorageBackendError(Exception):
    pass


@dataclass(frozen=True)
class LocalMediaStorage:
    root_dir: Path
    public_url_prefix: str = "/media"

    def __post_init__(self) -> None:
        object.__setattr__(self, "root_dir", self.root_dir.resolve())
        normalized_prefix = self.public_url_prefix.strip() or "/media"
        if not normalized_prefix.startswith("/"):
            normalized_prefix = f"/{normalized_prefix}"
        normalized_prefix = normalized_prefix.rstrip("/")
        object.__setattr__(self, "public_url_prefix", normalized_prefix)
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def save_upload(
        self,
        file: UploadFile,
        relative_path: Path,
        max_upload_bytes: int | None = None,
    ) -> int:
        normalized_relative = self._normalize_relative_path(relative_path)
        target_path = (self.root_dir / normalized_relative).resolve()
        target_path.parent.mkdir(parents=True, exist_ok=True)

        total_bytes = 0
        try:
            with open(target_path, "wb") as out_file:
                while True:
                    chunk = file.file.read(1024 * 1024)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if max_upload_bytes and total_bytes > max_upload_bytes:
                        raise FileTooLargeError("File too large")
                    out_file.write(chunk)
        finally:
            file.file.close()

        return total_bytes

    def public_url(self, relative_path: Path) -> str:
        normalized_relative = self._normalize_relative_path(relative_path)
        return f"{self.public_url_prefix}/{normalized_relative.as_posix()}"

    def resolve_relative_path_from_url(self, url: str) -> Path | None:
        if not isinstance(url, str):
            return None

        base = url.split("?", 1)[0].split("#", 1)[0]
        prefix = f"{self.public_url_prefix}/"
        if not base.startswith(prefix):
            return None

        relative_raw = unquote(base[len(prefix):]).strip()
        if not relative_raw:
            return None

        candidate = Path(relative_raw)
        try:
            return self._normalize_relative_path(candidate)
        except ValueError:
            return None

    def delete_relative_path(self, relative_path: Path) -> None:
        normalized_relative = self._normalize_relative_path(relative_path)
        target_path = (self.root_dir / normalized_relative).resolve()
        if target_path.is_file():
            target_path.unlink()

    def delete_by_url(self, url: str) -> None:
        relative_path = self.resolve_relative_path_from_url(url)
        if relative_path is None:
            return
        self.delete_relative_path(relative_path)

    def _normalize_relative_path(self, relative_path: Path) -> Path:
        candidate = Path(relative_path)
        if candidate.is_absolute():
            raise ValueError("Relative media path cannot be absolute")
        if ".." in candidate.parts:
            raise ValueError("Relative media path cannot contain parent traversal")
        normalized = Path(str(candidate).lstrip("/"))
        if str(normalized) in {"", "."}:
            raise ValueError("Relative media path cannot be empty")
        return normalized


def get_media_storage_from_env() -> LocalMediaStorage:
    backend = os.getenv("MEDIA_STORAGE_BACKEND", "local").strip().lower()
    if backend in {"local", "filesystem", "railway-volume"}:
        root_dir = Path(os.getenv("MEDIA_DIR", "media"))
        public_url_prefix = os.getenv("MEDIA_URL_PREFIX", "/media")
        return LocalMediaStorage(root_dir=root_dir, public_url_prefix=public_url_prefix)

    raise UnsupportedMediaStorageBackendError(
        f"Unsupported MEDIA_STORAGE_BACKEND '{backend}'. "
        "Supported values: local, filesystem, railway-volume"
    )
