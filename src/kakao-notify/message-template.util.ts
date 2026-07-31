/**
 * 문자(SMS) 본문 템플릿의 "#{변수명}" 자리표시자를 실제 값으로 치환한다.
 * 카카오 알림톡 변수 표기 규칙(#{변수명})과 동일하게 맞춰, 관리자가 두
 * 채널을 오갈 때 같은 방식으로 변수를 다루도록 한다.
 */
export function renderSmsTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/#\{([^}]+)\}/g, (match, key: string) =>
    key in variables ? variables[key] : match,
  );
}
