import TrainPlanner from '../components/TrainPlanner'

export default function Train() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Train</h1>
        <p className="text-muted mt-1">Pick a target player and get a 7-day plan for the gaps between you and them.</p>
      </div>
      <TrainPlanner />
    </div>
  )
}
