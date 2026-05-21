#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SIGNOZ_DIR="$PROJECT_ROOT/observability/signoz/repo"
SIGNOZ_COMPOSE_DIR="$SIGNOZ_DIR/deploy/docker"
SIGNOZ_REPO="https://github.com/SigNoz/signoz.git"
ACTION="${1:-up}"

# SigNoz 레포가 없으면 클론
if [ ! -d "$SIGNOZ_DIR" ]; then
  echo "SigNoz 레포 클론 중... (최초 1회)"
  git clone --depth=1 --branch main "$SIGNOZ_REPO" "$SIGNOZ_DIR"
  echo "클론 완료: $SIGNOZ_DIR"
fi

# 포트 충돌 체크 (Jaeger 등)
if [ "$ACTION" = "up" ]; then
  for PORT in 4317 4318 8080; do
    if lsof -i ":$PORT" -sTCP:LISTEN -t > /dev/null 2>&1; then
      echo "경고: 포트 $PORT 이미 사용 중입니다. Jaeger나 다른 프로세스와 충돌할 수 있어요."
    fi
  done
fi

cd "$SIGNOZ_COMPOSE_DIR"

if [ "$ACTION" = "down" ]; then
  echo "SigNoz 종료 중..."
  docker compose down
  echo "SigNoz 종료 완료"
elif [ "$ACTION" = "down:volumes" ]; then
  echo "SigNoz 종료 + 데이터 초기화 중..."
  docker compose down -v
  echo "SigNoz 종료 + 데이터 초기화 완료"
else
  echo "SigNoz 시작 중..."
  docker compose up -d --remove-orphans
  echo ""
  echo "SigNoz 시작 완료!"
  echo "  UI:        http://localhost:8080"
  echo "  OTLP HTTP: http://localhost:4318"
  echo "  OTLP gRPC: http://localhost:4317"
  echo ""
  echo "백엔드 OTLP endpoint: http://localhost:4318/v1/traces"
  echo "프론트 otelEndpoint:  http://localhost:{백엔드포트}/otel/v1/traces"
fi
