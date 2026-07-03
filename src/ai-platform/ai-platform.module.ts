import { Module } from "@nestjs/common";
import { NormalizerModule } from "./normalizer/normalizer.module";
import { FeatureEngineModule } from "./feature-engine/feature-engine.module";
import { TagEngineModule } from "./tag-engine/tag-engine.module";

/**
 * AI Platform V1 — Normalizer → Feature Engine → Tag Engine.
 * 향후 Score / Recommendation / User Memory / Reason / Rights / Bid Engine을
 * 추가할 때는 각각 독립 모듈로 만들어 이 imports 배열에 추가하면 된다.
 */
@Module({
  imports: [NormalizerModule, FeatureEngineModule, TagEngineModule],
})
export class AiPlatformModule {}
