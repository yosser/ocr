import { useState } from 'react'
import { api, scanImageUrl, useMutation, useQuery, type Scan } from './data'
import { pocketBaseErrorMessage } from './data/pocketBaseError'

function formatCreated(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function ScanItem({
  scan,
  removing,
  onRemove,
}: {
  scan: Scan
  removing: boolean
  onRemove: (id: string) => void
}) {
  return (
    <li className="history-item">
      <img src={scanImageUrl(scan)} alt="" />
      <div>
        <time dateTime={scan.created}>{formatCreated(scan.created)}</time>
        <pre>{scan.text || 'No text was found.'}</pre>
        <button
          className="text-button"
          type="button"
          onClick={() => onRemove(scan.id)}
          disabled={removing}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

export function ScanHistory() {
  const scans = useQuery(api.scans.list)
  const removeScan = useMutation(api.scans.remove)
  const [error, setError] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)

  async function remove(id: string) {
    setRemovingId(id)
    setError('')

    try {
      await removeScan({ id })
    } catch (caught) {
      setError(pocketBaseErrorMessage(caught, 'Could not remove the saved scan.'))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <section className="history">
      <h2>Saved scans</h2>
      {scans === undefined ? <p>Loading saved scans…</p> : null}
      {scans && scans.length === 0 ? <p>No saved scans yet.</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {scans && scans.length > 0 ? (
        <ul>
          {scans.map((scan) => (
            <ScanItem
              key={scan.id}
              scan={scan}
              removing={removingId === scan.id}
              onRemove={(id) => {
                void remove(id)
              }}
            />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
