// App frame: top navigation, page container, footer with data attribution.
import { NavLink, Outlet, Link } from 'react-router-dom'
import { StatsBombAttribution } from './ui'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/players', label: 'Players' },
  { to: '/me', label: 'My Profile' },
  { to: '/train', label: 'Train' },
  { to: '/coach', label: 'Live Coach' },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b border-line bg-bg/85 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="text-base sm:text-lg font-extrabold tracking-tight shrink-0">
            Soccer<span className="text-accent">Scout</span>
          </Link>
          <nav className="no-scrollbar flex gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `px-2 sm:px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${isActive
                  ? 'text-black bg-accent' : 'text-muted hover:text-white'}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
          <StatsBombAttribution />
          <p className="text-xs text-muted">Tier 1 basic stats: API-Football · Hackathon MVP · non-commercial · no video</p>
        </div>
      </footer>
    </div>
  )
}
