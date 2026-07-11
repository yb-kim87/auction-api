import { BadRequestException, Injectable } from "@nestjs/common";

export type KakaoSyncRunnerSource = "imweb" | "instagram";

export interface KakaoSyncRunState {
  running: boolean;
  processed: number;
  cancelRequested: boolean;
  startedAt: Date | null;
}

/**
 * "지금 동기화" 실행 상태를 메모리에 유지하고, 관리자가 진행 중인
 * 동기화를 중단 요청할 수 있게 한다. 실제 중단은 즉시 강제 종료가
 * 아니라, 다음 리드 처리 직전에 취소 플래그를 확인해 멈추는 방식이다.
 */
@Injectable()
export class KakaoSyncRunnerService {
  private readonly states = new Map<KakaoSyncRunnerSource, KakaoSyncRunState>();

  private getOrInit(source: KakaoSyncRunnerSource): KakaoSyncRunState {
    let state = this.states.get(source);
    if (!state) {
      state = { running: false, processed: 0, cancelRequested: false, startedAt: null };
      this.states.set(source, state);
    }
    return state;
  }

  getStatus(source: KakaoSyncRunnerSource): KakaoSyncRunState {
    return { ...this.getOrInit(source) };
  }

  start(source: KakaoSyncRunnerSource) {
    const state = this.getOrInit(source);
    if (state.running) {
      throw new BadRequestException("이미 동기화가 진행 중입니다.");
    }
    state.running = true;
    state.processed = 0;
    state.cancelRequested = false;
    state.startedAt = new Date();
  }

  progress(source: KakaoSyncRunnerSource) {
    this.getOrInit(source).processed += 1;
  }

  /** 취소 요청 여부를 확인한다. 호출부는 리드 1건 처리 후 이 값을 체크해 루프를 멈춘다. */
  isCancelRequested(source: KakaoSyncRunnerSource): boolean {
    return this.getOrInit(source).cancelRequested;
  }

  requestCancel(source: KakaoSyncRunnerSource) {
    const state = this.getOrInit(source);
    if (!state.running) {
      throw new BadRequestException("진행 중인 동기화가 없습니다.");
    }
    state.cancelRequested = true;
  }

  finish(source: KakaoSyncRunnerSource) {
    const state = this.getOrInit(source);
    state.running = false;
    state.cancelRequested = false;
  }
}
