function connectedDebtForAccount(account, debts) {
  return (debts || []).find(debt =>
    debt.plaid_account_record_id === account.id
    || (account.persistent_account_id && debt.plaid_persistent_account_id === account.persistent_account_id)
    || (account.plaid_account_id && debt.plaid_account_id === account.plaid_account_id)
  ) || null;
}

function accountsWithDebtStatus(accounts, debts) {
  return (accounts || []).map(account => {
    const debt = connectedDebtForAccount(account, debts);
    return {
      ...account,
      linked_debt_id: debt?.id || null,
      linked_debt_name: debt?.name || null,
      include_in_snowball: debt ? debt.include_in_snowball !== false : false,
    };
  });
}

module.exports = { accountsWithDebtStatus, connectedDebtForAccount };
