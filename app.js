import { h, render } from 'https://esm.sh/preact';
import { useState, useRef, useEffect } from 'https://esm.sh/preact/hooks';
import htm from 'https://esm.sh/htm';

const html = htm.bind(h);

function App() {
  const audioStates = {
    PLAYING: 'PLAYING',
    CUEING: 'CUEING',
  };

  const [audioState, setAudioState] = useState(null);
  const [cuePoint, setCuePoint] = useState(0);
  const [pausePoint, setPausePoint] = useState(0);
  const [tempo, setTempo] = useState(1);
  const [duration, setDuration] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [hasSongLoaded, setHasSongLoaded] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isUsingPressurePitchBend, setIsUsingPressurePitchBend] = useState(false);

  const currentTime = useRef(0);

  const audioCtx = useRef();
  const buffer = useRef();
  const source = useRef();

  const counterSource = useRef();
  const counterBuffer = useRef();
  const prp = useRef();

  const onFileChange = async (event) => {
    setHasSongLoaded(false);

    if (audioState) pausePlayback();
    currentTime.current = 0;
    setAudioState(null);
    setCuePoint(0);
    setPausePoint(0);
    setTempo(1);
    setTimeRemaining(null);

    audioCtx.current = new AudioContext();
    audioCtx.current.audioWorklet.addModule('reporter.js');

    const file = event.target.files[0];
    const fileBuffer = await file.arrayBuffer();
    try {
      buffer.current = await audioCtx.current.decodeAudioData(fileBuffer);
      setDuration(buffer.current.duration);

      counterBuffer.current = audioCtx.current.createBuffer(1, buffer.current.length, audioCtx.current.sampleRate);
      const length = counterBuffer.current.length
      const counterBufferCD = counterBuffer.current.getChannelData(0);
      for (let i = 0; i < length; ++i) {
        // Clamp to [0; 1].
        // Could clamp to [-1; 1) for higher precision, but it makes handling 0 troublesome.
        counterBufferCD[i] = i / length;
      }
      setHasSongLoaded(true);

      try {
        await navigator.wakeLock.request('screen');
      } catch (err) {
        alert(`Request to keep screen on denied:  ${err.name}, ${err.message}`);
      }

      const rawData = buffer.current.getChannelData(0);

      const samples = 1000;
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];
      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j])
        }
        filteredData.push(sum / blockSize);
      }

      const normalizeData = filteredData => {
        const multiplier = Math.pow(Math.max(...filteredData), -1);
        return filteredData.map(n => n * multiplier);
      }

      const graphData = normalizeData(filteredData);

      const canvas = document.querySelector("canvas");
      canvas.width = 1000;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");


      ctx.lineWidth = 10;
      ctx.strokeStyle = "#ccc";

      for (let i = 0; i < graphData.length; i++) {
        ctx.beginPath();
        ctx.moveTo(5 + (i * 10), canvas.height)
        ctx.lineTo(5 + (i * 10), canvas.height - (graphData[i] * canvas.height))
        ctx.stroke()
      }

    } catch (err) {
      alert(`Unable to load the audio file. Error: ${err.message}`);
    }
  };

  const startPlaybackAtTime = (offset = 0, speed = tempo) => {
    if (source.current) {
      source.current.stop();
    }
    if (counterSource.current) {
      counterSource.current.stop();
    }

    source.current = audioCtx.current.createBufferSource();
    source.current.buffer = buffer.current;
    source.current.connect(audioCtx.current.destination);

    counterSource.current = audioCtx.current.createBufferSource();
    counterSource.current.buffer = counterBuffer.current;


    prp.current = new AudioWorkletNode(audioCtx.current, 'position-reporting-processor');
    prp.current.port.onmessage = (e) => {
      currentTime.current = e.data * duration
    }

    counterSource.current.connect(prp.current);
    prp.current.connect(audioCtx.current.destination);

    source.current.start(0, offset);
    counterSource.current.start(0, offset);
    updatePlaybackSpeed(speed);
  };

  const pausePlayback = () => {
    counterSource.current.disconnect(prp.current);
    prp.current.disconnect();

    source.current.stop();
    counterSource.current.stop();
    setAudioState(null);
  };

  const updatePlaybackSpeed = (speed = tempo) => {
    source.current.playbackRate.value = speed;
    counterSource.current.playbackRate.value = speed;
  };

  const onPlayToggle = (e) => {
    e.preventDefault();

    if (!audioState) {
      setAudioState(audioStates.PLAYING);
      startPlaybackAtTime(pausePoint);
    } else if (audioState === audioStates.CUEING) {
      // Switch to continue playing if play button hit while cueing
      setAudioState(audioStates.PLAYING);
    } else {
      pausePlayback();
      setPausePoint(currentTime.current);
    }
  };

  const onSetCueDown = (e) => {
    e.preventDefault();
    if (audioState) {
      setCuePoint(currentTime.current);
    } else {
      setCuePoint(pausePoint)
    }
  };

  const onCueDown = (e) => {
    e.preventDefault();

    setAudioState(audioStates.CUEING);
    startPlaybackAtTime(cuePoint);
  };

  const onCueUp = (e) => {
    e.preventDefault();

    if (audioState === audioStates.CUEING) {
      pausePlayback();
      setPausePoint(currentTime.current);
    }
  };

  const pitchChangeIntervalRef = useRef();
  const onPitchBendPlusDown = (e) => {
    e.preventDefault();

    if (audioState && !isUsingPressurePitchBend) {
      let pitchMultiplier = 1;
      pitchChangeIntervalRef.current = setInterval(() => {
        if (pitchMultiplier < 2) {
          pitchMultiplier += 0.005;
          updatePlaybackSpeed(tempo * pitchMultiplier);
        }
      }, 30);
    }
  };

  const onPitchBendMinusDown = (e) => {
    e.preventDefault();

    if (audioState && !isUsingPressurePitchBend) {
      let pitchMultiplier = 1;
      pitchChangeIntervalRef.current = setInterval(() => {
        if (pitchMultiplier < 2) {
          pitchMultiplier += 0.005;
          updatePlaybackSpeed(tempo / pitchMultiplier);
        }
      }, 30);
    }
  };

  const onPitchBendUp = (e) => {
    clearInterval(pitchChangeIntervalRef.current);
    setIsUsingPressurePitchBend(false);
    e.preventDefault();

    if (audioState) {
      updatePlaybackSpeed();
    }
  };

  const onSeekForwardDown = (e) => {
    e.preventDefault();

    const speed = audioState ? 3 : 6;
    startPlaybackAtTime(currentTime.current, speed);
  };

  const onSeekBackDown = (e) => {
    e.preventDefault();

    const speed = audioState ? -3 : -6;
    startPlaybackAtTime(currentTime.current, speed);
  };

  const onSeekUp = (e) => {
    e.preventDefault();

    if (audioState) {
      updatePlaybackSpeed();
    } else {
      setPausePoint(currentTime.current);
      pausePlayback();
    }
  };

  const onPitchChange = (e) => {
    e.preventDefault();

    setTempo(e.target.value / 100);
  };

  const onScrubUp = (e) => {
    const newPoint = duration * e.target.value / 100;
    if (audioState) {
      startPlaybackAtTime(newPoint);
    } else {
      currentTime.current = newPoint;
      setPausePoint(newPoint);
    }
    setTimeout(() => setIsScrubbing(false), 100);
  }

  useEffect(() => {
    if (source.current) {
      updatePlaybackSpeed(tempo);
    }
  }, [tempo]);

  const remainingInterval = useRef();
  useEffect(() => {
    clearInterval(remainingInterval.current);
    remainingInterval.current = setInterval(() => {
      setTimeRemaining(Math.round(duration - currentTime.current));
    }, 100);
  }, [duration]);

  const pitchMinusButtonRef = useRef();
  const pitchPlusButtonRef = useRef();

  useEffect(() => {
    const onPitchMinusForceChange = (e) => {
      if (audioState) {
        e.preventDefault()
        if (e.webkitForce === 0) {
          setIsUsingPressurePitchBend(false)
          updatePlaybackSpeed()
        } else {
          updatePlaybackSpeed(tempo / (((e.webkitForce - 1) / 2) + 1));
        }
      }
    };

    const onPitchPlusForceChange = (e) => {
      if (audioState) {
        e.preventDefault()
        if (e.webkitForce === 0) {
          setIsUsingPressurePitchBend(false)
          updatePlaybackSpeed()
        } else {
          updatePlaybackSpeed(tempo * (((e.webkitForce - 1) / 2) + 1))
        }
      }
    };

    const onPitchChangeForceWillBegin = (e) => {
      e.preventDefault();
      setIsUsingPressurePitchBend(true);
    }

    pitchMinusButtonRef.current.addEventListener('webkitmouseforcechanged', onPitchMinusForceChange)
    pitchPlusButtonRef.current.addEventListener('webkitmouseforcechanged', onPitchPlusForceChange)
    pitchMinusButtonRef.current.addEventListener('webkitmouseforcewillbegin', onPitchChangeForceWillBegin);
    pitchPlusButtonRef.current.addEventListener('webkitmouseforcewillbegin', onPitchChangeForceWillBegin);

    return () => {
      pitchMinusButtonRef.current.removeEventListener('webkitmouseforcechanged', onPitchMinusForceChange)
      pitchPlusButtonRef.current.removeEventListener('webkitmouseforcechanged', onPitchPlusForceChange)
      pitchMinusButtonRef.current.removeEventListener('webkitmouseforcewillbegin', onPitchChangeForceWillBegin);
      pitchPlusButtonRef.current.removeEventListener('webkitmouseforcewillbegin', onPitchChangeForceWillBegin);
    };
  }, [audioState, tempo])

  useEffect(() => {
    const canvas = document.querySelector("canvas");
    canvas.width = 1000;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");

    ctx.lineWidth = 10;
    ctx.strokeStyle = "#999";

    for (let i = 0; i < 1000; i++) {
      ctx.beginPath();
      ctx.moveTo(5 + (i * 10), canvas.height)
      ctx.lineTo(5 + (i * 10), canvas.height / 2);
      ctx.stroke()
    }
  }, []);

  const [scrubValue, setScrubValue] = useState()

  const onMouseOver = (e) => {
    setScrubValue(e.offsetX / e.target.clientWidth)
  }

  const onMouseUp = (e) => {
    if (audioState === audioStates.PLAYING) {
      startPlaybackAtTime(e.offsetX / e.target.clientWidth * duration)
    } else {
      setPausePoint(e.offsetX / e.target.clientWidth * duration)
    }
  }


  return html`
  <div class="root">
    <div class="file-picker">
      <input
        onchange=${onFileChange}
        type="file">
      </input>
    </div>
    <div class="left-panel flex-container">
    <div class="buttons">
        <div class="progress-slider">
          <div onMouseMove=${onMouseOver} onMouseUp=${onMouseUp} onMouseOut=${() => setScrubValue(null)} class="progress-canvas">
            <canvas></canvas>
            <div class="point scrub-point" style="left: ${scrubValue * 100}%; visibility: ${scrubValue ? 'visible' : 'hidden'}" />
            <div class="point play-point" style="left: ${(audioState === audioStates.PLAYING ? currentTime.current : pausePoint) / duration * 100}%" />
            <div class="point cue-point" style="left: ${cuePoint / duration * 100}%" />
          </div>

          <div class="time-remaining ${hasSongLoaded ? 'loaded' : ''}">
            -${timeRemaining / 60 | 0}:${String(timeRemaining % 60).padStart(2, '0')} / ${Math.round(duration) / 60 | 0}:${String(Math.round(duration) % 60).padStart(2, '0')}
          </div>
        </div>
        <div class="seek-buttons flex-container">
          <button disabled=${!hasSongLoaded} onMouseDown=${onSeekBackDown} onTouchStart=${onSeekBackDown} onMouseUp=${onSeekUp} onTouchEnd=${onSeekUp}>Seek -</button>
          <button disabled=${!hasSongLoaded} onMouseDown=${onSeekForwardDown} onTouchStart=${onSeekForwardDown} onMouseUp=${onSeekUp} onTouchEnd=${onSeekUp}>Seek +</button>
        </div>
        <div class="pitch-buttons flex-container">
          <button
            disabled=${!hasSongLoaded}
            ref=${pitchMinusButtonRef}
            onMouseDown=${onPitchBendMinusDown}
            onTouchStart=${onPitchBendMinusDown}
            onMouseUp=${onPitchBendUp}
            onTouchEnd=${onPitchBendUp}
          >
            Pitch -
          </button>
          <button
            disabled=${!hasSongLoaded}
            ref=${pitchPlusButtonRef}
            onMouseDown=${onPitchBendPlusDown}
            onTouchStart=${onPitchBendPlusDown}
            onMouseUp=${onPitchBendUp}
            onTouchEnd=${onPitchBendUp}
          >
            Pitch +
          </button>
        </div>
        <div class="set-cue-button flex-container">
          <button disabled=${!hasSongLoaded} onMouseDown=${onSetCueDown} onTouchStart=${onSetCueDown}>Set Cue</button>
        </div>
        <div class="playback-buttons flex-container">
          <button
            class="${audioState === audioStates.PLAYING ? 'on' : ''}"
            id="play"
            disabled=${!hasSongLoaded}
            onMouseDown=${onPlayToggle}
            onTouchStart=${onPlayToggle}
          >
            Play/Pause
          </button>
          <button
            class="${audioState === audioStates.CUEING ? 'on' : ''}"
            id="cue"
            disabled=${!hasSongLoaded}
            onMouseDown=${onCueDown}
            onTouchStart=${onCueDown}
            onMouseUp=${onCueUp}
            onTouchEnd=${onCueUp}
          >
            Cue
          </button>
        </div>
      </div>
      <div class="tempo-slider">
        <hr class="zero-notch" />
        <input step="0.1" type="range" min="90" max="110" orient="vertical" onInput=${onPitchChange}></input>
      </div>
    </div>
  </div>
  `;
}

render(html`<${App} />`, document.body);
