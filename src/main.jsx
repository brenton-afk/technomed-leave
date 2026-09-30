import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerWorker } from './push.js'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Registered on load, but nothing is *asked* here. The worker exists only so a
// notification has something to be delivered to; permission is requested from a
// tap in the Messages screen, because iOS silently refuses a prompt that did not
// come from one and a refusal cannot be asked for again.
//
// It caches nothing — see public/sw.js for why that is deliberate.
registerWorker().catch(() => {
  // A browser that will not register one still runs the whole app. There is
  // nothing to tell anybody here; the Messages screen says what is possible on
  // this device, where somebody is actually asking the question.
})
