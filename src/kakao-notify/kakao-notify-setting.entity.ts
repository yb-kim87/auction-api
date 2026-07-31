import { Entity, PrimaryColumn, Column } from "typeorm";

/**
 * 현재는 "default" 하나만 사용한다(아임웹/인스타 모두 같은 템플릿으로 발송).
 * 향후 소스별로 템플릿을 분리해야 하면 "imweb"/"instagram" 키를 다시 쓸 수
 * 있도록 타입은 남겨둔다.
 */
export type KakaoNotifySettingKey = "default" | "imweb" | "instagram";

@Entity("kakao_notify_settings")
export class KakaoNotifySetting {
  @PrimaryColumn({ type: "text" })
  key!: KakaoNotifySettingKey;

  @Column({ type: "text", default: "" })
  templateCode!: string;

  @Column({ type: "text", default: "" })
  templateName!: string;

  /**
   * 템플릿의 카카오 변수 고정값 맵(JSON 문자열, 예: {"회원명":"","날짜":"7월 30일"}).
   * 리드 자동발송 시 "회원명"(또는 templateNameVar) 값만 리드의 실제 이름으로
   * 덮어쓰고 나머지는 여기 저장된 고정값을 그대로 사용한다.
   */
  @Column({ type: "text", default: "{}" })
  variablesJson!: string;

  /** variablesJson 중 리드 이름으로 자동 대체할 변수명(기본 "회원명") */
  @Column({ type: "text", default: "회원명" })
  templateNameVar!: string;

  /** 신규 리드 자동발송 시 사용할 채널. "sms"면 templateCode 대신 smsText를 사용한다. */
  @Column({ type: "text", default: "alimtalk" })
  channel!: "alimtalk" | "sms";

  /** channel이 sms일 때 사용할 본문 템플릿("#{회원명}" 등 변수 자리표시자 포함) */
  @Column({ type: "text", default: "" })
  smsText!: string;
}
