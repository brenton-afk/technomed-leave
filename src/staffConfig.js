// `isClinicalTeam` marks who is copied on every usage email. It lives here rather
// than as a list of addresses in api/_distributors.js so that changing someone's
// email cannot quietly drop them off the copy list — the roster is the one place
// a person is described, and this is a fact about a person.
//
// `firstName` is the name the team actually uses, which is why it is written down
// rather than derived: Brenton is Brent and Matthew is Mat, and no rule gets from
// one to the other. It goes on the bookings calendar to show who attended, so it
// has to match what everyone already writes there by hand.
export const STAFF = [
  { name: 'Brenton Lovering', email: 'brenton@technomed.com.au', firstName: 'Brent', division: 'Operations', role: 'Managing Director', isAdmin: true, isClinicalTeam: true, hasTimesheets: false, mobileNumber: '' },
  { name: 'Erin Smallbon', email: 'erin@technomed.com.au', firstName: 'Erin', division: 'Operations', role: 'General Manager', isAdmin: true, hasTimesheets: true, mobileNumber: '' },
  { name: 'Emma Lovering', email: 'marketing@technomed.com.au', firstName: 'Emma', division: 'Operations', role: 'Co-Founder, Brand Lead', isAdmin: false, hasTimesheets: false, mobileNumber: '' },
  { name: 'Toni Hoppitt', email: 'toni@technomed.com.au', firstName: 'Toni', division: 'Operations', role: 'Operations Coordinator', isAdmin: false, hasTimesheets: true, mobileNumber: '' },
  { name: 'Ben Cassidy', email: 'ben@technomed.com.au', firstName: 'Ben', division: 'Spine', role: 'Clinical Support Specialist', isAdmin: false, isClinicalTeam: true, hasTimesheets: true, mobileNumber: '' },
  { name: 'Matthew Usher', email: 'mat@technomed.com.au', firstName: 'Mat', division: 'CMF', role: 'Business Development and Director', isAdmin: false, isClinicalTeam: true, hasTimesheets: true, mobileNumber: '' },
  { name: 'Jeremy Sharpen', email: 'jeremy@technomed.com.au', firstName: 'Jeremy', division: 'Orthopaedics', role: 'Director of Orthopaedics', isAdmin: false, hasTimesheets: true, mobileNumber: '' },
  { name: 'April Foale', email: 'april@technomed.com.au', firstName: 'April', division: 'Orthopaedics', role: 'Clinical Support Specialist', isAdmin: false, hasTimesheets: true, mobileNumber: '' },
  { name: 'Aimee Vulinovich', email: 'aimee@technomed.com.au', firstName: 'Aimee', division: 'Spine', role: 'Clinical Support Specialist', isAdmin: false, isClinicalTeam: true, hasTimesheets: true, mobileNumber: '' }
]
export function getStaffByName(name) { return STAFF.find(s => s.name === name) }
export function getStaffByEmail(email) { return STAFF.find(s => s.email === email) }
