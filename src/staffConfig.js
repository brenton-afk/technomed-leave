export const STAFF = [
  { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', division: 'Operations', role: 'Managing Director', isAdmin: true, hasTimesheets: false },
  { name: 'Erin Smallbon', email: 'erin@technomed.com.au', division: 'Operations', role: 'General Manager', isAdmin: true, hasTimesheets: true },
  { name: 'Emma Lovering', email: 'marketing@technomed.com.au', division: 'Operations', role: 'Co-Founder, Brand Lead', isAdmin: false, hasTimesheets: false },
  { name: 'Toni Hoppitt', email: 'toni@technomed.com.au', division: 'Operations', role: 'Operations Coordinator', isAdmin: false, hasTimesheets: true },
  { name: 'Ben Cassidy', email: 'ben@technomed.com.au', division: 'Spine', role: 'Clinical Support Specialist', isAdmin: false, hasTimesheets: true },
  { name: 'Matthew Usher', email: 'mat@technomed.com.au', division: 'CMF', role: 'Business Development and Director', isAdmin: false, hasTimesheets: true },
  { name: 'Jeremy Sharpen', email: 'jeremy@technomed.com.au', division: 'Orthopaedics', role: 'Director of Orthopaedics', isAdmin: false, hasTimesheets: true },
  { name: 'April Foale', email: 'april@technomed.com.au', division: 'Orthopaedics', role: 'Clinical Support Specialist', isAdmin: false, hasTimesheets: true },
  { name: 'Aimee Vulinovich', email: 'aimee@technomed.com.au', division: 'Spine', role: 'Clinical Support Specialist', isAdmin: false, hasTimesheets: true }
]
export function getStaffByName(name) { return STAFF.find(s => s.name === name) }
export function getStaffByEmail(email) { return STAFF.find(s => s.email === email) }
