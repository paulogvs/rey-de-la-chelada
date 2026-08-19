export interface OrderReviewLine {
  quantity: number;
  unitPrice: number;
}

export interface OrderReviewSummary {
  lineCount: number;
  totalQuantity: number;
  total: number;
}

export function summarizeOrderReview(lines: OrderReviewLine[]): OrderReviewSummary {
  return lines.reduce<OrderReviewSummary>((summary, line) => ({
    lineCount: summary.lineCount + 1,
    totalQuantity: summary.totalQuantity + line.quantity,
    total: Math.round((summary.total + line.quantity * line.unitPrice) * 100) / 100,
  }), { lineCount: 0, totalQuantity: 0, total: 0 });
}
