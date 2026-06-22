# 📓 업무일지 (Work Log)

주 / 월 / 분기 / 년 단위로 한눈에 보는 노션 스타일 업무일지 웹앱.

- **백엔드**: Node.js + Express
- **데이터베이스**: Turso (libSQL)
- **프론트엔드**: 바닐라 JS (빌드 단계 없음)
- **배포**: Render Blueprint (무료 플랜)

## 기능

- 업무일지 작성 / 수정 / 삭제 (날짜·제목·내용·태그)
- 기간 탭: **주간 / 월간 / 분기 / 연간**, 이전·다음·오늘 이동
- 요약 카드: 총 일지 수, 활동한 날, 태그 종류, 최다 태그
- 날짜별 그룹 보기

## 로컬 실행

```bash
npm install
npm start
```

`.env` 파일에 아래 값이 필요합니다 (이미 준비됨):

```
TURSO_URL=libsql://...
TURSO_TOKEN=...
```

브라우저에서 http://localhost:3000 접속.

## Render 배포 (무료)

1. 이 폴더를 GitHub 저장소로 push (`.env`는 `.gitignore`로 제외됨).
2. Render → **New > Blueprint** → 저장소 선택. `render.yaml`이 자동 인식됩니다.
3. 배포 시 환경변수 두 개를 입력합니다 (비밀값이라 블루프린트에 포함하지 않음):
   - `TURSO_URL`
   - `TURSO_TOKEN`
4. 생성된 URL로 접속.

> `render.yaml`은 `plan: free`로 고정되어 있어 항상 무료 플랜으로 배포됩니다.
> 무료 웹 서비스는 15분간 요청이 없으면 휴면하며, 다음 접속 시 다시 깨어납니다.

## DB 스키마

서버 시작 시 `entries` 테이블이 자동 생성됩니다.

| 컬럼 | 설명 |
|------|------|
| id | PK |
| work_date | 업무 날짜 (YYYY-MM-DD) |
| title | 제목 |
| content | 내용 |
| tags | 쉼표로 구분된 태그 |
| created_at / updated_at | 타임스탬프 |
