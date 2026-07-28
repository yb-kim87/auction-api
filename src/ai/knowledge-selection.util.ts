export type KnowledgeSelectionRow<T> = {
  item: T & { grade: number; updatedAt: Date };
  score: number;
};

function byRelevance<T>(
  a: KnowledgeSelectionRow<T>,
  b: KnowledgeSelectionRow<T>,
) {
  return (
    b.score - a.score ||
    b.item.updatedAt.getTime() - a.item.updatedAt.getTime()
  );
}

/**
 * DB의 기존 grade 값은 호환성을 위해 유지하되 의미를 적용 정책으로 쓴다.
 * 1=항상 적용, 2=조건부 적용, 3=참고 자료.
 */
export function selectKnowledgeByApplicationPolicy<T>(
  rows: KnowledgeSelectionRow<T>[],
  conditionalLimit = 3,
  referenceLimit = 1,
): T[] {
  const always = rows
    .filter((row) => row.item.grade === 1)
    .sort(byRelevance);
  const conditional = rows
    .filter((row) => row.item.grade === 2 && row.score > 0)
    .sort(byRelevance)
    .slice(0, conditionalLimit);
  const reference = rows
    .filter((row) => row.item.grade === 3 && row.score > 0)
    .sort(byRelevance)
    .slice(0, referenceLimit);

  return [...always, ...conditional, ...reference].map((row) => row.item);
}
