from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

from models.database import Base


class NodeEmbedding(Base):
    __tablename__ = "node_embeddings"

    id = Column(Integer, primary_key=True)
    node_id = Column(Integer, ForeignKey("content_nodes.id", ondelete="CASCADE"), nullable=False)
    language_code = Column(Text, nullable=False)
    content_type = Column(Text, nullable=False)
    embedding = Column(Vector(1536))
    model = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "node_id",
            "language_code",
            "content_type",
            name="uq_node_embeddings_node_lang_content",
        ),
    )
