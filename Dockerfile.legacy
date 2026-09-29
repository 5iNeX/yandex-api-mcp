FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml README.md /app/
COPY src /app/src
COPY docs/templates/dashboard-template-option1-2026-01-28.html /app/docs/templates/dashboard-template-option1-2026-01-28.html

ARG MCP_EDITION=public
ARG MCP_PLUGIN_PIP=""

# Security: pull OS security updates and upgrade pip tooling (wheel has known CVEs).
RUN sed -i "s|http://deb.debian.org|https://deb.debian.org|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=3 -o Acquire::https::Timeout=30 update \
  && apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir --upgrade pip wheel \
  && pip install --no-cache-dir -e . \
  && if [ -n "${MCP_PLUGIN_PIP}" ]; then pip install --no-cache-dir ${MCP_PLUGIN_PIP}; fi

ENV PYTHONUNBUFFERED=1
ARG MCP_PUBLIC_READONLY=true
ENV MCP_PUBLIC_READONLY=${MCP_PUBLIC_READONLY}
ENV MCP_EDITION=${MCP_EDITION}

# Build marker used by the runtime to force safe defaults for the public image.
RUN echo "${MCP_EDITION}" > /app/.mcp_edition

# Default to a non-root user (recommended for public images).
# If you need to override (e.g. file permissions on mounted volumes), run with: `--user root`.
RUN useradd -m -u 10001 -s /usr/sbin/nologin app \
  && chown -R app:app /app
USER app

CMD ["yandex-direct-metrica-mcp"]
