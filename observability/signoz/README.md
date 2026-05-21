# SigNoz 로컬 실행 가이드

SigNoz는 공식 레포를 클론해서 docker compose로 실행합니다.

## 빠른 시작

```bash
# 프로젝트 루트에서
npm run dev:signoz
```

`scripts/dev-signoz.sh`가 자동으로:
1. SigNoz 공식 레포를 `observability/signoz/repo/`에 클론 (최초 1회)
2. `docker compose up -d` 실행

## 접속

| 서비스 | URL |
|--------|-----|
| SigNoz UI | http://localhost:8080 |
| OTLP gRPC | localhost:4317 |
| OTLP HTTP | localhost:4318 |

## 종료

```bash
npm run dev:signoz:down
```

## 포트 충돌 주의

Jaeger가 실행 중이라면 포트 4317/4318이 충돌합니다.
SigNoz 시작 전 Jaeger를 먼저 종료하세요.

## 데이터 초기화

```bash
cd observability/signoz/repo/deploy/docker
docker compose down -v   # 볼륨 삭제 (trace 데이터 전체 초기화)
```
