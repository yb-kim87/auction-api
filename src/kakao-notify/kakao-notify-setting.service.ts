import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KakaoNotifySetting } from "./kakao-notify-setting.entity";
import type { KakaoLead } from "./kakao-lead.entity";

const SETTING_KEY = "default" as const;

/** 변수값이 "$field:xxx" 형태면 발송 시점에 리드의 해당 필드값으로 치환한다. */
const FIELD_REF_PREFIX = "$field:";

export const LEAD_FIELD_OPTIONS: Array<{ field: keyof KakaoLead; label: string }> = [
  { field: "name", label: "이름" },
  { field: "phone", label: "전화번호" },
  { field: "email", label: "이메일" },
  { field: "gender", label: "성별" },
  { field: "birthDate", label: "생년월일" },
  { field: "address", label: "주소" },
  { field: "adName", label: "유입소재(광고명)" },
];

@Injectable()
export class KakaoNotifySettingService {
  constructor(
    @InjectRepository(KakaoNotifySetting)
    private readonly repo: Repository<KakaoNotifySetting>,
  ) {}

  /** 아임웹/인스타 구분 없이 항상 이 하나의 설정을 사용한다. */
  async getDefault(): Promise<KakaoNotifySetting> {
    const existing = await this.repo.findOne({ where: { key: SETTING_KEY } });
    return (
      existing ??
      this.repo.create({
        key: SETTING_KEY,
        templateCode: "",
        templateName: "",
        variablesJson: "{}",
        templateNameVar: "회원명",
        channel: "alimtalk",
        smsText: "",
      })
    );
  }

  async upsertDefault(input: {
    templateCode: string;
    templateName: string;
    variables: Record<string, string>;
    templateNameVar?: string;
    channel?: "alimtalk" | "sms";
    smsText?: string;
  }): Promise<KakaoNotifySetting> {
    const setting = await this.getDefault();
    setting.templateCode = input.templateCode.trim();
    setting.templateName = input.templateName.trim();
    setting.variablesJson = JSON.stringify(input.variables ?? {});
    if (input.templateNameVar !== undefined) {
      setting.templateNameVar = input.templateNameVar.trim() || "회원명";
    }
    if (input.channel !== undefined) {
      setting.channel = input.channel;
    }
    if (input.smsText !== undefined) {
      setting.smsText = input.smsText;
    }
    return this.repo.save(setting);
  }

  /**
   * 리드 자동발송용: 저장된 변수 설정(고정값 또는 "$field:필드명" 참조)을
   * 실제 리드 데이터로 치환해 최종 변수 맵을 만든다. 이름 변수(nameVar)를
   * 포함해 모든 변수는 관리자가 설정한 값/필드 참조를 그대로 따른다 — 기본값은
   * "$field:name"으로 세팅되어 있어 평소엔 리드 이름이 발송되지만, 관리자가
   * 다른 필드나 직접입력 값으로 바꾸면 그 값이 그대로 발송된다.
   */
  async resolveVariables(lead: Pick<KakaoLead, keyof KakaoLead> | { name: string }): Promise<{
    templateCode: string;
    variables: Record<string, string>;
    channel: "alimtalk" | "sms";
    smsText: string;
  }> {
    const setting = await this.getDefault();
    let base: Record<string, string> = {};
    try {
      base = JSON.parse(setting.variablesJson || "{}");
    } catch {
      base = {};
    }
    return {
      templateCode: setting.templateCode,
      variables: this.resolveVariablesFor(lead, base, setting.templateNameVar || "회원명"),
      channel: setting.channel || "alimtalk",
      smsText: setting.smsText || "",
    };
  }

  /**
   * 관리자가 목록에서 골라 즉석으로 선택한 템플릿으로 일괄발송할 때 사용.
   * 저장된 기본 설정과 무관하게, 넘겨준 variables 기준으로 "$field:필드명"
   * 참조를 리드 데이터로 치환한다. nameVar 자체는 강제 대체하지 않고, 관리자가
   * 설정해둔 값(고정값 또는 필드 참조)을 그대로 사용한다. nameVar가 variables에
   * 아예 없을 때만(설정 누락 등 예외적 상황) 리드 이름으로 안전하게 채운다.
   */
  resolveVariablesFor(
    lead: Pick<KakaoLead, keyof KakaoLead> | { name: string },
    variables: Record<string, string>,
    nameVar: string,
  ): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (value.startsWith(FIELD_REF_PREFIX)) {
        const field = value.slice(FIELD_REF_PREFIX.length) as keyof KakaoLead;
        const raw = (lead as Record<string, unknown>)[field];
        resolved[key] = raw ? String(raw) : "";
      } else {
        resolved[key] = value;
      }
    }
    if (!(nameVar in resolved)) {
      resolved[nameVar] = lead.name || "고객";
    }
    return resolved;
  }
}
