export type FlowType = 'income' | 'spending' | 'transfer' | 'credit_card_payment' | 'debt_payment';

/**
 * Deterministic classification of a transaction's flow type from Plaid's
 * personal_finance_category, independent of the (partly LLM-assigned) display
 * `category`. This is what every spend/income/runway aggregate filters on —
 * it must not depend on the categorizer so money-safety math can't drift when
 * a display category is reassigned.
 */
export function deriveFlowType(
  plaidCategory: string | null | undefined,
  plaidCategoryDetailed: string | null | undefined
): FlowType {
  switch (plaidCategory) {
    case 'INCOME':
      return 'income';
    case 'TRANSFER_IN':
    case 'TRANSFER_OUT':
      return 'transfer';
    case 'LOAN_PAYMENTS':
      return plaidCategoryDetailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'
        ? 'credit_card_payment'
        : 'debt_payment';
    default:
      // Matches today's behavior: NULL/unknown Plaid category counts as spending.
      return 'spending';
  }
}
