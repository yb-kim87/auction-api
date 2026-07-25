# 작업 히스토리 문서화 규칙

새 요청을 시작하기 전, [docs/history/README.md](docs/history/README.md)를 먼저 읽고 그 규칙을 따른다.

핵심 요약:
- 유사 주제의 기존 문서(`docs/history/YYYY-MM-DD_NN_주제.md`)가 있으면 그 문서에 追記, 없으면 새 문서 생성.
- 작업 종료 시 변경 내용과 결과를 반드시 해당 문서에 기록한다(누락 금지).
- 기존 문서의 서술이 이번 작업으로 사실과 달라지면 追記만 하지 말고 그 부분을 최신 상태로 갱신한다.

# 배포 후 서버 정상 작동 확인 규칙

auction-api(Railway)든 auction(Vercel)이든, 커밋·푸시로 배포를 트리거한 뒤에는
**반드시 실제 서버가 정상 기동/응답하는지 확인**하고 나서 작업 완료로 보고한다.
"push 했다"는 "배포가 성공했다"를 의미하지 않는다 — 엔티티 미등록, 마이그레이션
실패 등으로 배포 직후 크래시할 수 있다(실측 사례: 2026-07-25, CrawlerLogRow를
`crawler.module.ts`의 forFeature에만 등록하고 `typeorm.config.ts`의 전역
entities 배열에 빠뜨려 `EntityMetadataNotFoundError`로 즉시 크래시 → 운영
API 전체 다운).

확인 방법:
- auction-api: `railway status`로 서비스 상태가 크래시가 아닌지 확인하고,
  `curl -s -o /dev/null -w "%{http_code}" <운영 API 헬스체크 엔드포인트>`로
  실제로 200이 오는지 확인한다. 배포 반영에 시간이 걸리므로 즉시 안 되면
  Monitor 등으로 몇 차례 재시도한다.
- auction: `npx vercel ls`로 최신 배포가 Ready 상태인지 확인한다.
- 문제가 발견되면 바로 원인을 진단해 수정하고, 다시 push해서 정상화될 때까지
  이 확인을 반복한다. "커밋/push 완료"만으로 작업 종료를 보고하지 않는다.
