import { BadRequestException, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { WebinarKakaoLead } from "./webinar-kakao-lead.entity";

const KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token";
const KAKAO_USER_URL = "https://kapi.kakao.com/v2/user/me";

interface KakaoTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface KakaoUserResponse {
  id?: number;
  kakao_account?: {
    email?: string;
    profile?: { nickname?: string; profile_image_url?: string };
    phone_number?: string;
  };
  error?: string;
  error_description?: string;
}

@Injectable()
export class WebinarAuthService {
  private readonly logger = new Logger(WebinarAuthService.name);

  constructor(
    @InjectRepository(WebinarKakaoLead)
    private readonly repo: Repository<WebinarKakaoLead>,
  ) {}

  private get restApiKey() {
    const key = process.env.KAKAO_REST_API_KEY?.trim();
    if (!key) throw new InternalServerErrorException("KAKAO_REST_API_KEY가 설정되지 않았습니다.");
    return key;
  }

  private get clientSecret() {
    return process.env.KAKAO_CLIENT_SECRET?.trim() || undefined;
  }

  private get redirectUri() {
    const uri = process.env.KAKAO_REDIRECT_URI?.trim();
    if (!uri) throw new InternalServerErrorException("KAKAO_REDIRECT_URI가 설정되지 않았습니다.");
    return uri;
  }

  /** 인가 코드를 액세스 토큰으로 교환하고, 사용자 정보를 조회해 저장한다. */
  async handleCallback(code: string): Promise<WebinarKakaoLead> {
    if (!code) throw new BadRequestException("code가 필요합니다.");

    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.restApiKey,
      redirect_uri: this.redirectUri,
      code,
    });
    if (this.clientSecret) tokenParams.set("client_secret", this.clientSecret);

    const tokenRes = await fetch(KAKAO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: tokenParams.toString(),
    });
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as KakaoTokenResponse;
    if (!tokenRes.ok || !tokenBody.access_token) {
      this.logger.error(`카카오 토큰 교환 실패: ${JSON.stringify(tokenBody)}`);
      throw new BadRequestException(tokenBody.error_description ?? "카카오 인증에 실패했습니다.");
    }

    const userRes = await fetch(KAKAO_USER_URL, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const userBody = (await userRes.json().catch(() => ({}))) as KakaoUserResponse;
    if (!userRes.ok || !userBody.id) {
      this.logger.error(`카카오 사용자 정보 조회 실패: ${JSON.stringify(userBody)}`);
      throw new BadRequestException(userBody.error_description ?? "카카오 사용자 정보를 가져오지 못했습니다.");
    }

    const kakaoId = String(userBody.id);
    const account = userBody.kakao_account ?? {};

    let lead = await this.repo.findOne({ where: { kakaoId } });
    if (!lead) {
      lead = this.repo.create({ kakaoId });
    }
    lead.nickname = account.profile?.nickname ?? "";
    lead.email = account.email ?? "";
    lead.phone = account.phone_number ?? "";
    lead.profileImageUrl = account.profile?.profile_image_url ?? "";
    lead.rawPayload = JSON.stringify(userBody);

    return this.repo.save(lead);
  }

  /** 관리자 페이지의 "웨비나 신청자" 탭에서 사용. 최신 신청순으로 정렬. */
  async findAll(): Promise<WebinarKakaoLead[]> {
    return this.repo.find({ order: { createdAt: "DESC" } });
  }
}
