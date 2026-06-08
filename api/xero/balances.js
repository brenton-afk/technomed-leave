import { getXeroToken, findEmployee } from '../_xeroClient.js'

export default async function handler(req, res) {
  const { name } = req.query
  if (!name) return res.status(400).json({ error: 'Name required' })

  try {
    const token = await getXeroToken()
    const tenantId = process.env.XERO_TENANT_ID

    // Find employee by name
    const employee = await findEmployee(token, tenantId, name)
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found in Xero' })
    }

    // Fetch leave balances
    const balancesRes = await fetch(
      `https://api.xero.com/payroll.xro/1.0/Employees/${employee.EmployeeID}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Xero-tenant-id': tenantId,
          Accept: 'application/json'
        }
      }
    )

    const data = await balancesRes.json()
    const emp = data.Employees?.[0]

    if (!emp) return res.status(404).json({ error: 'Employee data not found' })

    const balances = (emp.LeaveBalances || []).map(b => ({
      leaveType: b.LeaveName,
      leaveTypeID: b.LeaveTypeID,
      balanceHours: parseFloat(b.BalanceHours || 0).toFixed(1)
    }))

    res.status(200).json(balances)
  } catch (err) {
    console.error('Balance fetch error:', err)
    res.status(500).json({ error: 'Could not fetch leave balances' })
  }
}
