import { Injectable } from "@nestjs/common";
import { join } from "path";
import PDFDocument from "pdfkit";

export interface ContractFields {
  clientName: string;
  clientBirth: string;
  clientAddress: string;
  clientPhone: string;
  contractDate: string;
  retainerFee: string;
  feeRate: string;
  companyName: string;
  companyCeo: string;
  companyAddress: string;
  companyPhone: string;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
}

const FONT_REGULAR = join(process.cwd(), "assets/fonts/Pretendard-Regular.ttf");
const FONT_BOLD = join(process.cwd(), "assets/fonts/Pretendard-Bold.ttf");

const BODY_CLAUSES: string[] = [
  "제1조 (목적)",
  "본 계약은 갑의 부동산 경매 참여와 관련하여 을이 경매 컨설팅 서비스를 제공하고 갑이 이에 대한 보수를 지급하는데 필요한 사항을 정함을 목적으로 한다.",
  "제2조 (업무 범위)",
  "을은 다음 각 호의 업무를 수행한다.\n1. 경매 물건 탐색 및 추천\n2. 권리분석\n3. 시세조사 및 가치분석\n4. 현장 임장 체크리스트 및 임장 가이드 제공\n5. 입찰가 산정\n6. 입찰절차 안내\n7. 대출 상담 및 금융기관 연결 지원\n8. 명도 지원",
  "제3조 (의뢰인의 의무)",
  "1. 갑은 임장, 자금조달, 입찰 및 잔금납부를 성실히 진행하여야 한다.\n2. 갑은 컨설팅 진행에 필요한 정보를 사실대로 제공하여야 한다.\n3. 갑은 을이 추천한 물건에 대하여 입찰 진행 의사를 확정한 경우 을이 제시한 입찰 전략 및 입찰가를 신의성실의 원칙에 따라 준수하여야 한다.\n4. 갑이 을과 사전 협의 없이 입찰가를 임의로 변경하거나 정당한 사유 없이 입찰을 포기하는 경우 을은 본 계약을 해지할 수 있다.\n5. 전항에 따라 계약이 해지되는 경우 기지급된 착수금은 반환되지 아니하며 갑은 이에 대하여 이의를 제기하지 않는다.\n6. 갑이 입찰 의사를 확정한 후 자금 부족, 가족 반대, 투자계획 변경, 대출 문제 등 갑의 사정으로 입찰을 진행하지 않는 경우에는 갑의 귀책사유로 본다.\n7. 갑은 을이 추천한 물건에 대하여 합리적인 기간 내에 의사결정을 하여야 하며, 정당한 사유 없이 의사결정을 반복적으로 지연하여 컨설팅 진행이 어렵다고 판단되는 경우 을은 본 계약을 해지할 수 있다.",
];

function clauses4to10(f: ContractFields): string[] {
  return [
    "제4조 (보수)",
    `1. 갑은 계약 체결과 동시에 착수금 ${f.retainerFee}원을 지급한다.\n2. 착수금은 컨설팅 업무 착수 및 진행에 대한 대가이며 어떠한 경우에도 반환되지 않는다.\n3. 컨설팅 보수는 실제 낙찰가액의 ${f.feeRate}%로 한다.\n컨설팅 보수 = 낙찰가액 × ${f.feeRate}%\n4. 기지급한 착수금은 최종 컨설팅 보수에서 공제한다.\n5. 갑은 낙찰 완료일에 컨설팅 보수 50%를 지급한다.\n6. 갑은 명도 완료일로부터 7일 이내에 남은 컨설팅 보수 50%를 지급한다.\n7. 갑이 지급기한 내 컨설팅 보수를 지급하지 않을 경우 지급기한 다음 날부터 완제일까지 연 12%의 지연손해금을 추가로 지급한다.\n\n• 보수지급계좌\n은행 : ${f.bankName}\n계좌번호 : ${f.bankAccount}\n예금주 : ${f.bankHolder}`,
    "제5조 (명도 완료의 정의)",
    "본 계약에서 명도 완료란 점유자가 해당 부동산을 퇴거하고 낙찰자가 해당 부동산을 자유롭게 점유 및 사용할 수 있는 상태가 된 경우를 의미한다.",
    "제6조 (중도해지)",
    "1. 갑의 사정으로 계약을 중도 해지하는 경우 착수금은 반환되지 않는다.\n2. 자금 부족, 대출 거절, 투자계획 변경, 가족 반대 등의 사유는 갑의 귀책사유로 본다.\n3. 을의 고의 또는 중대한 과실이 없는 한 갑은 기지급한 착수금의 반환을 청구할 수 없다.",
    "제7조 (우회거래 금지)",
    "1. 갑이 을이 추천, 소개 또는 분석한 물건을 본인, 배우자, 직계존비속, 형제자매, 특수관계인 또는 법인을 통하여 낙찰받거나 취득한 경우 본 계약상 보수 지급 의무가 발생한다.\n2. 갑은 을의 사전 동의 없이 제3자를 통하여 동일 물건을 낙찰받거나 취득하여 보수 지급을 회피할 수 없다.\n3. 본 조항은 본 계약이 종료되거나 해지된 이후에도 유효하며, 갑은 을이 추천·소개·분석한 물건을 취득한 경우 본 계약에 따른 보수를 지급하여야 한다.",
    "제8조 (책임의 제한)",
    "1. 을은 계약 체결 이후 낙찰 시까지 지속적인 물건 추천 및 컨설팅을 제공한다.\n2. 을은 대출 승인 여부를 보장하지 않는다.\n3. 경매 물건 특성상 을은 공부서류, 현장조사, 외관 확인 및 기타 확인 가능한 자료를 기반으로 분석을 수행한다.\n4. 점유자의 비협조 또는 출입 제한 등으로 확인할 수 없는 내부 상태에 대하여 책임을 부담하지 않는다.\n5. 갑은 경매 물건의 특성상 낙찰 이후 예상하지 못한 하자 또는 추가 비용이 발생할 수 있음을 충분히 인지하고 이를 감수한 상태에서 입찰에 참여한다.\n6. 시장 상황, 정책 변경, 금리 변동, 법령 개정 등에 따른 손실은 갑의 책임으로 한다.",
    "제9조 (계약의 종료)",
    "1. 본 계약은 갑이 을의 컨설팅을 통해 낙찰받은 부동산의 명도가 완료된 시점에 종료된다.\n2. 제3조에 따른 계약 해지 사유가 발생한 경우 을은 즉시 계약을 종료할 수 있다.\n3. 계약 종료 후에도 제7조(우회거래 금지) 및 제10조(비밀유지)는 계속 유효하다.",
    "제10조 (비밀유지)",
    "1. 갑과 을은 계약 수행 과정에서 알게 된 상대방의 개인정보, 거래정보 및 컨설팅 자료를 상대방의 동의 없이 제3자에게 제공하거나 누설하여서는 아니 된다.",
  ];
}

@Injectable()
export class ContractService {
  generatePdf(f: ContractFields): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 56 });
      doc.registerFont("Pretendard", FONT_REGULAR);
      doc.registerFont("Pretendard-Bold", FONT_BOLD);

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.font("Pretendard-Bold").fontSize(20).text("경매 컨설팅 계약서", { align: "center" });
      doc.moveDown(0.8);

      doc
        .font("Pretendard")
        .fontSize(11)
        .text(
          `${f.clientName} (이하 "갑")과 ${f.companyName} (이하 "을")는 경매를 통한 부동산 취득을 위한 컨설팅 업무에 관하여 다음과 같이 계약을 체결한다.`,
        );
      doc.moveDown(1);

      const writeClause = (title: string, body: string) => {
        doc.font("Pretendard-Bold").fontSize(12).text(title);
        doc.moveDown(0.2);
        doc.font("Pretendard").fontSize(10.5).text(body, { lineGap: 2 });
        doc.moveDown(0.8);
      };

      for (let i = 0; i < BODY_CLAUSES.length; i += 2) {
        writeClause(BODY_CLAUSES[i], BODY_CLAUSES[i + 1]);
      }
      const rest = clauses4to10(f);
      for (let i = 0; i < rest.length; i += 2) {
        writeClause(rest[i], rest[i + 1]);
      }

      doc.moveDown(0.5);
      doc.font("Pretendard").fontSize(10.5).text(
        "본 계약의 체결을 증명하기 위하여 갑과 을은 아래와 같이 서명한다.",
      );
      doc.text(`계약체결일 : ${f.contractDate}`);
      doc.moveDown(1);

      doc.font("Pretendard-Bold").fontSize(11).text("[갑]");
      doc
        .font("Pretendard")
        .fontSize(10.5)
        .text(
          `성명 : ${f.clientName}\n생년월일 : ${f.clientBirth}\n주소 : ${f.clientAddress}\n연락처 : ${f.clientPhone}\n서명(전자서명 또는 자필서명) :`,
        );
      doc.moveDown(0.8);

      doc.font("Pretendard-Bold").fontSize(11).text("[을]");
      doc
        .font("Pretendard")
        .fontSize(10.5)
        .text(
          `상호 : ${f.companyName}\n대표 : ${f.companyCeo}\n주소 : ${f.companyAddress}\n연락처 : ${f.companyPhone}\n서명(전자서명 또는 자필서명) :`,
        );

      doc.end();
    });
  }
}
