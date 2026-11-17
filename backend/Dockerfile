FROM python:3.11-slim-bookworm AS dependencies
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
WORKDIR /build
COPY backend/requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

FROM python:3.11-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
WORKDIR /app/backend
COPY --from=dependencies /install /usr/local
COPY --chown=app:app backend/app ./app
COPY --chown=app:app data/seed /app/data/seed
COPY --chown=app:app data/images /app/data/images
RUN mkdir media && chown app:app media
USER app
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8000}\" --workers 1"]
