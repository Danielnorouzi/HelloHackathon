import { useEffect, useState } from 'react'
import { get } from './api'

/** Fetch a GET endpoint; re-runs when the path changes. Returns { data, error, loading }. */
export default function useFetch(path) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path })
  useEffect(() => {
    if (!path) return
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    get(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }))
    return () => { alive = false }
  }, [path])
  return state
}
