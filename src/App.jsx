import React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import LeaveForm from './pages/LeaveForm.jsx'
import XeroCallback from './pages/XeroCallback.jsx'
import Success from './pages/Success.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LeaveForm />} />
        <Route path="/success" element={<Success />} />
        <Route path="/api/xero/callback" element={<XeroCallback />} />
      </Routes>
    </BrowserRouter>
  )
}
