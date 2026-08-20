/** 강의실 메인(/courses) 소개 페이지의 이미지 슬롯 정의.
 * key: 프론트(courses/page.tsx)가 참조하는 슬롯 키.
 * label: 관리자 페이지에 표시할 이름.
 * recommendedSize: 관리자에게 안내할 권장 이미지 규격(px, 가로x세로).
 * defaultUrl: 아직 관리자가 교체하지 않았을 때 보여줄 기본 이미지. */
export interface LandingImageSlotDef {
  key: string;
  label: string;
  recommendedSize: string;
  defaultUrl: string;
}

export const LANDING_IMAGE_SLOTS: LandingImageSlotDef[] = [
  {
    key: "logo-light",
    label: "로고 (밝은 배경용)",
    recommendedSize: "800 x 300px, 투명 배경 PNG",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/logo/logo-light.png",
  },
  {
    key: "logo-dark",
    label: "로고 (어두운 배경용, 푸터)",
    recommendedSize: "800 x 260px, 투명 배경 PNG",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/logo/logo-dark.png",
  },
  {
    key: "hero-main",
    label: "히어로 메인 배너",
    recommendedSize: "2400 x 1340px 이상 (가로형, 16:9 근접)",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/hero/hero-temp.png",
  },
  {
    key: "mascot",
    label: "마스코트 아이콘",
    recommendedSize: "500 x 620px, 투명 배경 PNG",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/favicon/favicon-nobg.png",
  },
  {
    key: "solution-1",
    label: "조각 학습법 설명 이미지 1",
    recommendedSize: "800 x 800px",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/solution/solution-1.png",
  },
  {
    key: "solution-2",
    label: "조각 학습법 설명 이미지 2",
    recommendedSize: "800 x 800px",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/solution/solution-2.png",
  },
  {
    key: "solution-3",
    label: "조각 학습법 설명 이미지 3",
    recommendedSize: "800 x 800px",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/solution/solution-3.png",
  },
  {
    key: "effect-travel",
    label: "효과 카드 - 여행",
    recommendedSize: "1000 x 600px",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/effects/effect-travel.gif",
  },
  {
    key: "effect-content",
    label: "효과 카드 - 콘텐츠",
    recommendedSize: "1000 x 600px",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/effects/effect-content.gif",
  },
  {
    key: "effect-career",
    label: "효과 카드 - 커리어",
    recommendedSize: "1000 x 600px",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/effects/effect-business.jpg",
  },
  {
    key: "effect-package",
    label: "효과 카드 - 패키지 구성",
    recommendedSize: "1000 x 600px",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/effects/effect-study.jpg",
  },
  {
    key: "curriculum-1",
    label: "커리큘럼 로드맵 이미지 1 (WEEK 1-2)",
    recommendedSize: "1400 x 3600px 내외 (세로 인포그래픽)",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/curriculum/curriculum-1.png",
  },
  {
    key: "curriculum-2",
    label: "커리큘럼 로드맵 이미지 2 (WEEK 3-4)",
    recommendedSize: "1400 x 3000px 내외 (세로 인포그래픽)",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/curriculum/curriculum-2.png",
  },
  {
    key: "curriculum-3",
    label: "커리큘럼 로드맵 이미지 3 (WEEK 5-8)",
    recommendedSize: "1400 x 4000px 내외 (세로 인포그래픽)",
    defaultUrl: "https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/curriculum/curriculum-3.png",
  },
  // 수강신청 페이지(/courses/apply) "강의소개" 섹션에 세로로 쭉 나열되는
  // 상세 이미지 23장. 슬롯 키는 detail-1 ~ detail-23.
  ...Array.from({ length: 23 }, (_, i) => {
    const n = i + 1;
    const padded = String(n).padStart(2, "0");
    const ext = n === 23 ? "webp" : n % 2 === 1 ? "gif" : "webp";
    const filename = n === 23 ? "detail-23v2" : `detail-${padded}`;
    return {
      key: `detail-${n}`,
      label: `수강신청 상세 이미지 ${n}`,
      recommendedSize: "1200px 폭 내외 (세로로 이어붙는 상세 소개 이미지)",
      defaultUrl: `https://pub-94525708f97b4c5e901e4362678fd78c.r2.dev/detail/${filename}.${ext}`,
    };
  }),
];

export const LANDING_IMAGE_SLOT_KEYS = LANDING_IMAGE_SLOTS.map((s) => s.key);
