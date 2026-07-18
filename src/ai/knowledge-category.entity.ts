import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from "typeorm";

/** AI지식 등록 시 선택하는 분류 마스터 목록. 관리자가 화면에서 자유롭게
 *  추가/삭제한다(지식 항목의 category 컬럼은 여전히 자유 텍스트지만,
 *  등록 폼에서는 이 테이블에 있는 값만 선택할 수 있게 해 오타·분산을
 *  막는다). 어떤 분류를 어느 AI 파이프라인이 참고할지는 백엔드 코드에서
 *  개별로 연결한다(예: ai-analysis.service.ts는 "권리분석" 고정).*/
@Entity("knowledge_categories")
@Unique("UQ_knowledge_categories_name", ["name"])
export class KnowledgeCategory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
