import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import PlayersPage from './pages/PlayersPage'
import PlayerPage from './pages/PlayerPage'
import MyProfile from './pages/MyProfile'
import Train from './pages/Train'
import LiveCoach from './pages/LiveCoach'
import { EmptyState } from './components/ui'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="players" element={<PlayersPage />} />
        <Route path="players/:key" element={<PlayerPage />} />
        <Route path="players/:key/:tab" element={<PlayerPage />} />
        <Route path="me" element={<MyProfile />} />
        <Route path="train" element={<Train />} />
        <Route path="coach" element={<LiveCoach />} />
        <Route path="*" element={<EmptyState title="Page not found" />} />
      </Route>
    </Routes>
  )
}
