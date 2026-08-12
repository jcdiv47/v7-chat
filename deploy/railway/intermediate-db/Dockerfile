FROM postgres:17-alpine

COPY init-intermediate.sh /docker-entrypoint-initdb.d/10-readonly.sh

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" || exit 1
