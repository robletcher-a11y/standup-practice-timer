import { useEffect, useRef, useState } from 'react'

const DEFAULT_MINUTES = 5
const DEFAULT_SECONDS = 0
const FLASH_DURATION_MS = 1500 // 3 flashes x 500ms, matches the CSS animation

function formatTime(totalSeconds) {
  const clamped = Math.max(0, totalSeconds)
  const minutes = Math.floor(clamped / 60)
  const seconds = clamped % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function pickMimeType(withVideo) {
  const candidates = withVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

const METER_UPDATE_INTERVAL_MS = 50 // ~20fps, plenty smooth without re-rendering every animation frame
const METER_GAIN = 4 // amplifies typical speaking volume so the bar reads clearly

function getRmsLevel(analyser, dataArray) {
  analyser.getByteTimeDomainData(dataArray)
  let sumSquares = 0
  for (let i = 0; i < dataArray.length; i++) {
    const normalized = (dataArray[i] - 128) / 128
    sumSquares += normalized * normalized
  }
  const rms = Math.sqrt(sumSquares / dataArray.length)
  return Math.min(1, rms * METER_GAIN)
}

export default function App() {
  const [minutesInput, setMinutesInput] = useState(DEFAULT_MINUTES)
  const [secondsInput, setSecondsInput] = useState(DEFAULT_SECONDS)
  const totalSeconds = minutesInput * 60 + secondsInput

  const [remaining, setRemaining] = useState(totalSeconds)
  const [status, setStatus] = useState('stopped') // 'stopped' | 'running' | 'paused' | 'finished'
  const [isFlashing, setIsFlashing] = useState(false)
  const hasFlashedRef = useRef(false)

  const [videoEnabled, setVideoEnabled] = useState(true)
  const [recordingUrl, setRecordingUrl] = useState(null)
  const [recordingHasVideo, setRecordingHasVideo] = useState(true)
  const [recordingError, setRecordingError] = useState(null)
  const [audioLevel, setAudioLevel] = useState(0)

  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const livePreviewRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const meterDataRef = useRef(null)
  const meterFrameRef = useRef(null)

  // Keep the preview in sync with the duration inputs while stopped.
  useEffect(() => {
    if (status === 'stopped') setRemaining(totalSeconds)
  }, [totalSeconds, status])

  // Tick the countdown once per second while running.
  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1
        if (next === 60 && !hasFlashedRef.current) {
          hasFlashedRef.current = true
          setIsFlashing(true)
          setTimeout(() => setIsFlashing(false), FLASH_DURATION_MS)
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [status])

  // Stop automatically once time runs out.
  useEffect(() => {
    if (status === 'running' && remaining <= 0) setStatus('finished')
  }, [remaining, status])

  // Release the camera/mic if the page is closed mid-recording.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (meterFrameRef.current) cancelAnimationFrame(meterFrameRef.current)
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close()
      }
    }
  }, [])

  // Attach the live camera stream once the preview <video> element has actually
  // mounted (it only renders once status flips to running/paused, which happens
  // after the stream is acquired, so this can't be done inline in handleStart).
  useEffect(() => {
    const isRecordingNow = status === 'running' || status === 'paused'
    if (
      isRecordingNow &&
      videoEnabled &&
      livePreviewRef.current &&
      streamRef.current &&
      livePreviewRef.current.srcObject !== streamRef.current
    ) {
      livePreviewRef.current.srcObject = streamRef.current
    }
  }, [status, videoEnabled])

  const startMeter = (stream) => {
    const audioContext = new AudioContext()
    audioContext.resume().catch(() => {})
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    audioContext.createMediaStreamSource(stream).connect(analyser)

    audioContextRef.current = audioContext
    analyserRef.current = analyser
    meterDataRef.current = new Uint8Array(analyser.frequencyBinCount)

    let lastUpdate = 0
    const tick = (timestamp) => {
      if (timestamp - lastUpdate >= METER_UPDATE_INTERVAL_MS) {
        lastUpdate = timestamp
        setAudioLevel(getRmsLevel(analyserRef.current, meterDataRef.current))
      }
      meterFrameRef.current = requestAnimationFrame(tick)
    }
    meterFrameRef.current = requestAnimationFrame(tick)
  }

  const stopMeter = () => {
    if (meterFrameRef.current) cancelAnimationFrame(meterFrameRef.current)
    meterFrameRef.current = null
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
    }
    audioContextRef.current = null
    analyserRef.current = null
    setAudioLevel(0)
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    recorderRef.current = null
    streamRef.current = null
    stopMeter()
  }

  const handleStart = async () => {
    const isFreshRun = status === 'stopped' || status === 'finished'

    if (isFreshRun) {
      setRecordingError(null)
      if (recordingUrl) URL.revokeObjectURL(recordingUrl)
      setRecordingUrl(null)

      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true })
      } catch {
        setRecordingError('Camera/microphone access was denied or unavailable.')
        return
      }

      streamRef.current = stream
      startMeter(stream)

      chunksRef.current = []
      const mimeType = pickMimeType(videoEnabled)
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || (videoEnabled ? 'video/webm' : 'audio/webm') })
        setRecordingUrl(URL.createObjectURL(blob))
        setRecordingHasVideo(videoEnabled)
      }
      recorderRef.current = recorder
      recorder.start()

      hasFlashedRef.current = false
      setIsFlashing(false)
      setRemaining(totalSeconds)
    } else if (status === 'paused') {
      recorderRef.current?.resume()
    }

    setStatus('running')
  }

  const handlePause = () => {
    recorderRef.current?.pause()
    setStatus('paused')
  }

  const handleReset = () => {
    stopRecording()
    setStatus('stopped')
    setRemaining(totalSeconds)
    hasFlashedRef.current = false
    setIsFlashing(false)
    setRecordingError(null)
  }

  // Auto-finish also needs to stop the in-progress recording.
  useEffect(() => {
    if (status === 'finished') stopRecording()
  }, [status])

  const inputsDisabled = status === 'running' || status === 'paused'
  const isWarning = remaining <= 60 && remaining > 0
  const isFinished = status === 'finished'
  const isRecording = status === 'running' || status === 'paused'

  return (
    <div className="app">
      <div className={`flash-overlay ${isFlashing ? 'flashing' : ''}`} />

      <div className="duration-inputs">
        <div className="duration-field">
          <label htmlFor="minutes-input">min</label>
          <input
            id="minutes-input"
            type="number"
            min="0"
            value={minutesInput}
            disabled={inputsDisabled}
            onChange={(e) => {
              setMinutesInput(Math.max(0, Number(e.target.value)))
              if (status === 'finished') setStatus('stopped')
            }}
          />
        </div>
        <div className="duration-field">
          <label htmlFor="seconds-input">sec</label>
          <input
            id="seconds-input"
            type="number"
            min="0"
            max="59"
            value={secondsInput}
            disabled={inputsDisabled}
            onChange={(e) => {
              setSecondsInput(Math.min(59, Math.max(0, Number(e.target.value))))
              if (status === 'finished') setStatus('stopped')
            }}
          />
        </div>
        <label className="video-toggle">
          <input
            type="checkbox"
            checked={videoEnabled}
            disabled={inputsDisabled}
            onChange={(e) => {
              setVideoEnabled(e.target.checked)
              if (status === 'finished') setStatus('stopped')
            }}
          />
          Record video
        </label>
      </div>

      <div className={`countdown ${isWarning ? 'warning' : ''} ${isFinished ? 'finished' : ''}`}>
        {formatTime(remaining)}
      </div>

      {isFinished && <div className="time-up">TIME'S UP</div>}

      <div className="controls">
        {status === 'running' ? (
          <button onClick={handlePause}>Pause</button>
        ) : (
          <button onClick={handleStart}>{status === 'paused' ? 'Resume' : 'Start'}</button>
        )}
        <button onClick={handleReset}>Reset</button>
      </div>

      {recordingError && <div className="recording-error">{recordingError}</div>}

      {isRecording && videoEnabled && (
        <video ref={livePreviewRef} className="live-preview" autoPlay muted playsInline />
      )}
      {isRecording && !videoEnabled && (
        <div className="recording-indicator">
          <span className="dot" /> Recording audio
        </div>
      )}

      {isRecording && (
        <div className="level-meter">
          <div className="level-meter-fill" style={{ width: `${Math.round(audioLevel * 100)}%` }} />
        </div>
      )}

      {recordingUrl && !isRecording && (
        <div className="playback">
          {recordingHasVideo ? (
            <video src={recordingUrl} controls className="playback-video" />
          ) : (
            <audio src={recordingUrl} controls />
          )}
          <a
            className="download-link"
            href={recordingUrl}
            download={`set-practice-${Date.now()}.webm`}
          >
            Download
          </a>
        </div>
      )}
    </div>
  )
}
