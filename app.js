import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// this line needs to be here

// ---- Fill these in with your project's values (Supabase dashboard > Settings > API) ----
const SUPABASE_URL = 'https://zkjwwhvuhgppvqltkvgw.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_70wU7xuznXHpLRN5_daGqQ_lmVpgNyV'
// -----------------------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const container = document.getElementById('shelves-container')
const dialog = document.getElementById('item-dialog')
const form = document.getElementById('item-form')
const dialogTitle = document.getElementById('dialog-title')
const shelfSelect = document.getElementById('shelf-select')

const loginScreen = document.getElementById('login-screen')
const loginForm = document.getElementById('login-form')
const forgotPasswordBtn = document.getElementById('forgot-password-btn')
const resetScreen = document.getElementById('reset-screen')
const resetForm = document.getElementById('reset-form')
const addBtn = document.getElementById('open-add-btn')
const signOutBtn = document.getElementById('sign-out-btn')

const filterBar = document.getElementById('filter-bar')
const searchInput = document.getElementById('search-input')
const locationFilter = document.getElementById('location-filter')

let shelves = []   // storage_shelves rows, cached for the dropdown + grouping labels
let allItems = []  // food_items rows from the last successful load, cached so filtering doesn't need a new database call

init()

async function init() {
  document.getElementById('cancel-btn').addEventListener('click', closeDialog)
  form.addEventListener('submit', handleSave)
  loginForm.addEventListener('submit', handleLogin)
  forgotPasswordBtn.addEventListener('click', handleForgotPassword)
  resetForm.addEventListener('submit', handlePasswordUpdate)
  addBtn.addEventListener('click', () => openDialog())
  signOutBtn.addEventListener('click', () => supabase.auth.signOut())
  searchInput.addEventListener('input', applyFilters)
  locationFilter.addEventListener('change', applyFilters)

  // React whenever auth state changes: initial load, sign-in, sign-out, token refresh.
  // Supabase fires a special 'PASSWORD_RECOVERY' event when someone arrives via a
  // password reset link — we need to catch that BEFORE treating it as a normal sign-in,
  // otherwise the recovery session just drops the person straight into the app with
  // nowhere to actually type a new password.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      showResetPassword()
    } else if (session) {
      showApp()
    } else {
      showLogin()
    }
  })

  const { data: { session } } = await supabase.auth.getSession()
  if (session) showApp(); else showLogin()
}

function showLogin() {
  loginScreen.classList.remove('hidden')
  resetScreen.classList.add('hidden')
  container.classList.add('hidden')
  filterBar.classList.add('hidden')
  addBtn.classList.add('hidden')
  signOutBtn.classList.add('hidden')
}

function showResetPassword() {
  loginScreen.classList.add('hidden')
  resetScreen.classList.remove('hidden')
  container.classList.add('hidden')
  filterBar.classList.add('hidden')
  addBtn.classList.add('hidden')
  signOutBtn.classList.add('hidden')
}

async function showApp() {
  loginScreen.classList.add('hidden')
  resetScreen.classList.add('hidden')
  container.classList.remove('hidden')
  filterBar.classList.remove('hidden')
  addBtn.classList.remove('hidden')
  signOutBtn.classList.remove('hidden')

  await loadShelves()
  await loadItems()
}

async function handleLogin(e) {
  e.preventDefault()
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return showError(error.message)

  loginForm.reset()
  // onAuthStateChange will fire and call showApp()
}

async function handleForgotPassword() {
  const email = document.getElementById('login-email').value.trim()
  if (!email) {
    return showError('Enter your email above first, then click "Forgot password?"')
  }

  // redirectTo must exactly match an entry in Supabase's Authentication ->
  // URL Configuration -> Redirect URLs allow-list, or the email link will fail
  // silently. Using window.location.origin + pathname means this always points
  // at wherever the app is actually hosted, instead of a hardcoded URL.
  const redirectTo = window.location.origin + window.location.pathname

  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) return showError(error.message)

  alert(`Password reset email sent to ${email}. Check your inbox for the link.`)
}

async function handlePasswordUpdate(e) {
  e.preventDefault()
  const newPassword = document.getElementById('new-password').value

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return showError(error.message)

  resetForm.reset()
  alert('Password updated. You\'re now signed in.')
  await showApp()
}

// ---------- Data loading ----------

async function loadShelves() {
  const { data, error } = await supabase
    .from('storage_shelves')
    .select('*')
    .order('kitchen_loc', { ascending: true })
    .order('shelf_num', { ascending: true })

  if (error) return showError(error.message)

  shelves = data
  shelfSelect.innerHTML = shelves
    .map(s => `<option value="${s.id}">${s.kitchen_loc} — shelf ${s.shelf_num}</option>`)
    .join('')

  // Build the "All locations" dropdown from the distinct kitchen_loc values.
  // Set(...) automatically drops duplicates, so each location appears once even
  // though storage_shelves has one row per shelf (often several rows per location).
  const uniqueLocations = [...new Set(shelves.map(s => s.kitchen_loc))]
  locationFilter.innerHTML =
    '<option value="">All locations</option>' +
    uniqueLocations.map(loc => `<option value="${loc}">${loc}</option>`).join('')
}

async function loadItems() {
  const { data, error } = await supabase
    .from('food_items')
    .select('*, storage_shelves(id, kitchen_loc, shelf_num)')
    .order('food_name', { ascending: true })

  if (error) return showError(error.message)

  allItems = data
  applyFilters()
}

// Re-filters the already-loaded items (no new database call) based on the
// current search text and selected location, then re-renders the list.
function applyFilters() {
  const searchText = searchInput.value.trim().toLowerCase()
  const selectedLocation = locationFilter.value

  const filtered = allItems.filter(item => {
    const matchesSearch = item.food_name.toLowerCase().includes(searchText)
    const matchesLocation = !selectedLocation || item.storage_shelves?.kitchen_loc === selectedLocation
    return matchesSearch && matchesLocation
  })

  renderItems(filtered)
}

// ---------- Rendering ----------

function renderItems(items) {
  container.innerHTML = ''

  if (items.length === 0) {
    const message = allItems.length === 0
      ? 'Nothing in stock yet. Add your first item.'
      : 'No items match your search.'
    container.innerHTML = `<p class="empty-state">${message}</p>`
    return
  }

  // Group by kitchen_loc, then by shelf_num
  const byLocation = new Map()
  for (const item of items) {
    const loc = item.storage_shelves?.kitchen_loc ?? 'Unknown location'
    if (!byLocation.has(loc)) byLocation.set(loc, new Map())
    const byShelf = byLocation.get(loc)
    const shelfNum = item.storage_shelves?.shelf_num ?? '?'
    if (!byShelf.has(shelfNum)) byShelf.set(shelfNum, [])
    byShelf.get(shelfNum).push(item)
  }

  for (const [loc, byShelf] of [...byLocation.entries()].sort()) {
    const group = document.createElement('section')
    group.className = 'location-group'

    const title = document.createElement('h2')
    title.className = 'location-title'
    title.textContent = loc
    group.appendChild(title)

    for (const [shelfNum, shelfItems] of [...byShelf.entries()].sort((a, b) => a[0] - b[0])) {
      const block = document.createElement('div')
      block.className = 'shelf-block'

      const label = document.createElement('p')
      label.className = 'shelf-label'
      label.textContent = `Shelf ${shelfNum}`
      block.appendChild(label)

      for (const item of shelfItems) {
        block.appendChild(renderItemRow(item))
      }

      group.appendChild(block)
    }

    container.appendChild(group)
  }
}

function renderItemRow(item) {
  const row = document.createElement('div')
  row.className = 'item-row'

  const status = expiryStatus(item.expir_date)
  if (status) row.classList.add(status)

  const main = document.createElement('div')
  main.className = 'item-main'

  const name = document.createElement('div')
  name.className = 'item-name'
  name.textContent = item.food_name
  main.appendChild(name)

  const dates = document.createElement('div')
  dates.className = 'item-dates'
  dates.innerHTML = datesLabel(item, status)
  main.appendChild(dates)

  row.appendChild(main)

  const actions = document.createElement('div')
  actions.className = 'item-actions'

  const editBtn = document.createElement('button')
  editBtn.className = 'icon-btn'
  editBtn.textContent = 'Edit'
  editBtn.addEventListener('click', () => openDialog(item))
  actions.appendChild(editBtn)

  const delBtn = document.createElement('button')
  delBtn.className = 'icon-btn delete'
  delBtn.textContent = 'Remove'
  delBtn.addEventListener('click', () => handleDelete(item.id))
  actions.appendChild(delBtn)

  row.appendChild(actions)
  return row
}

function expiryStatus(expirDate) {
  if (!expirDate) return null
  const today = new Date()
  const exp = new Date(expirDate)
  const daysLeft = (exp - today) / (1000 * 60 * 60 * 24)
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 5) return 'expiring-soon'
  return null
}

function datesLabel(item, status) {
  const parts = []
  if (item.date_purchased) parts.push(`bought ${item.date_purchased}`)
  if (item.expir_date) {
    const flag = status === 'expired' ? ' (expired)' : status === 'expiring-soon' ? ' (soon)' : ''
    parts.push(`expires ${item.expir_date}<span class="flag">${flag}</span>`)
  }
  return parts.join(' · ') || 'No dates recorded'
}

// ---------- Dialog / form ----------

function openDialog(item = null) {
  form.reset()
  dialogTitle.textContent = item ? 'Edit item' : 'Add item'
  document.getElementById('item-id').value = item?.id ?? ''
  document.getElementById('food-name').value = item?.food_name ?? ''
  document.getElementById('date-purchased').value = item?.date_purchased ?? ''
  document.getElementById('expir-date').value = item?.expir_date ?? ''
  shelfSelect.value = item?.shelf_id ?? shelves[0]?.id ?? ''
  dialog.classList.remove('hidden')
}

function closeDialog() {
  dialog.classList.add('hidden')
}

async function handleSave(e) {
  e.preventDefault()

  const id = document.getElementById('item-id').value
  const payload = {
    food_name: document.getElementById('food-name').value.trim(),
    shelf_id: Number(shelfSelect.value),
    date_purchased: document.getElementById('date-purchased').value || null,
    expir_date: document.getElementById('expir-date').value || null,
  }

  const { error } = id
    ? await supabase.from('food_items').update(payload).eq('id', id)
    : await supabase.from('food_items').insert(payload)

  if (error) return showError(error.message)

  closeDialog()
  await loadItems()
}

async function handleDelete(id) {
  if (!confirm('Remove this item?')) return
  const { error } = await supabase.from('food_items').delete().eq('id', id)
  if (error) return showError(error.message)
  await loadItems()
}

// ---------- Errors ----------

function showError(message) {
  const existing = document.querySelector('.error-banner')
  if (existing) existing.remove()
  const banner = document.createElement('div')
  banner.className = 'error-banner'
  banner.textContent = message
  document.body.insertBefore(banner, document.querySelector('.topbar').nextSibling)
  console.error(message)
}