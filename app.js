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
  const [isUsingPressurePitchBend, setIsUsingPressurePitchBend] = useState(false);
  const [scrubValue, setScrubValue] = useState(null);

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
        alert('Request to keep screen on during playback denied. Switch autolock off in device settings ' +
          'to stop the screen and audio switching off during inactivity.'
        );
      }

      const rawData = buffer.current.getChannelData(0);

      const samples = 100;
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

      const canvas = document.querySelector('canvas');
      canvas.width = 1000;
      canvas.height = 200;
      const ctx = canvas.getContext('2d');


      ctx.lineWidth = 10;
      ctx.strokeStyle = '#ccc';

      for (let i = 0; i < graphData.length; i++) {
        ctx.beginPath();
        const x = 5 + (i * 10);
        ctx.moveTo(x, canvas.height)
        ctx.lineTo(x, canvas.height - (graphData[i] * canvas.height))
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
    setPausePoint(currentTime.current);
    currentTime.current = 0;
  };

  const updatePlaybackSpeed = (speed = tempo) => {
    source.current.playbackRate.value = speed;
    counterSource.current.playbackRate.value = speed;
  };

  const onPlayToggle = (e) => {
    e.preventDefault();

    if (audioCtx.current?.state === 'suspended') {
      audioCtx.current.resume();
    }

    if (hasSongLoaded) {
      if (!audioState) {
        setAudioState(audioStates.PLAYING);
        startPlaybackAtTime(pausePoint);
      } else if (audioState === audioStates.CUEING) {
        // Switch to continue playing if play button hit while cueing
        setAudioState(audioStates.PLAYING);
      } else {
        pausePlayback();
      }
    }
  };

  const onSetCueDown = (e) => {
    e.preventDefault();

    e.target.classList.add('active');

    if (audioState) {
      setCuePoint(currentTime.current);
    } else {
      setCuePoint(pausePoint)
    }
  };

  const onSetCueUp = (e) => {
    e.target.classList.remove('active');
  };

  const onCueDown = (e) => {
    e.preventDefault();

    if (hasSongLoaded) {
      setAudioState(audioStates.CUEING);
      startPlaybackAtTime(cuePoint);
    }
  };

  const onCueUp = (e) => {
    e.preventDefault();

    if (audioState === audioStates.CUEING) {
      pausePlayback();
    }
  };

  const pitchChangeIntervalRef = useRef();

  const onPitchBendPlusDown = (e) => {
    e.preventDefault();


    if (audioState && !isUsingPressurePitchBend) {
      e.target.classList.add('active');
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
      e.target.classList.add('active');
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

    e.target.classList.remove('active');

    if (audioState) {
      updatePlaybackSpeed();
    }
  };

  const onSeekForwardDown = (e) => {
    e.preventDefault();

    e.target.classList.add('active');

    const speed = audioState ? 3 : 6;
    if (audioState === audioStates.PLAYING) {
      startPlaybackAtTime(currentTime.current, speed);
    } else {
      startPlaybackAtTime(pausePoint, speed);
    }
  };

  const onSeekBackDown = (e) => {
    e.preventDefault();

    e.target.classList.add('active');

    if (audioState === audioStates.PLAYING) {
      startPlaybackAtTime(currentTime.current, -3);
    } else if (audioState === audioStates.CUEING) {
      startPlaybackAtTime(currentTime.current, -1);
    } else {
      startPlaybackAtTime(pausePoint, -6);
    }
  };

  const onSeekUp = (e) => {
    e.preventDefault();

    e.target.classList.remove('active');

    if (audioState) {
      updatePlaybackSpeed();
    } else {
      pausePlayback();
    }
  };

  const onPitchChange = (e) => {
    e.preventDefault();

    e.target.classList.add('active');

    setTempo(e.target.value / 100);
  };

  const onPitchChangeEnd = (e) => {
    e.target.classList.remove('active');
  };

  useEffect(() => {
    if (source.current) {
      updatePlaybackSpeed(tempo);
    }
  }, [tempo]);

  const remainingInterval = useRef();
  useEffect(() => {
    clearInterval(remainingInterval.current);
    remainingInterval.current = setInterval(() => {
      setTimeRemaining(Math.round(duration - (currentTime.current || pausePoint)));
    }, 100);
  }, [duration, pausePoint]);

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
    const canvas = document.querySelector('canvas');
    canvas.width = 1000;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');

    ctx.lineWidth = canvas.width;
    ctx.strokeStyle = '#999';
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, canvas.height)
    ctx.lineTo(canvas.width / 2, canvas.height / 2);
    ctx.stroke()
  }, []);

  const onScrubOver = (e) => {
    e.preventDefault();

    setScrubValue(e.offsetX / e.target.clientWidth)
  };

  const onScrubFinish = (e) => {
    e.preventDefault();

    const scrubTime = e.offsetX / e.target.clientWidth * duration;
    const newTime = scrubTime > 0 ? scrubTime : 0;
    if (audioState === audioStates.PLAYING) {
      startPlaybackAtTime(newTime);
    } else {
      setPausePoint(newTime);
    }
    setScrubValue(null);
  };

  const onScrubOut = (e) => {
    e.preventDefault();

    setScrubValue(null);
  };

  const tempoRef = useRef();

  useEffect(() => {
    tempoRef.current.value = tempo * 100;
  }, [tempo])

  const tempoChangeIntervalRef = useRef();

  const onTempoMinusDown = (e) => {
    e.preventDefault();
    tempoRef.current.classList.add('active');

    tempoChangeIntervalRef.current = setInterval(() => {
      setTempo(currentTempo => currentTempo > 0.9 ? currentTempo -= 0.00002 : currentTempo);
    }, 10);
  };

  const onTempoPlusDown = (e) => {
    e.preventDefault();
    tempoRef.current.classList.add('active');

    tempoChangeIntervalRef.current = setInterval(() => {
      setTempo(currentTempo => currentTempo < 1.1 ? currentTempo += 0.00002 : currentTempo);
    }, 10);
  };

  const onTempoButtonUp = () => {
    clearInterval(tempoChangeIntervalRef.current);
    tempoRef.current.classList.remove('active');
  };

  return html`
  <div class="root">
    <div class="file-picker">
      <input
        onchange=${onFileChange}
        type="file">
      </input>
    </div>
    <div class="flex-container under-file-picker">
      <div class="buttons">
        <div class="timeline">
          <div 
            class="timeline-canvas-container"
            onTouchMove=${onScrubOver} 
            onMouseMove=${onScrubOver} 
            onMouseUp=${onScrubFinish} 
            onMouseOut=${onScrubOut} 
          >
            <canvas></canvas>
            <div class="timeline-point scrub-point" style="left: ${scrubValue * 100}%; visibility: ${scrubValue ? 'visible' : 'hidden'}" />
            <div class="timeline-point play-point" style="left: ${(currentTime.current || pausePoint) / duration * 100}%" />
            <div class="timeline-point cue-point" style="left: ${cuePoint / duration * 100}%" />
          </div>
          <div class="time-remaining ${hasSongLoaded ? 'loaded' : ''}">
            -${timeRemaining / 60 | 0}:${String(timeRemaining % 60).padStart(2, '0')} / ${Math.round(duration) / 60 | 0}:${String(Math.round(duration) % 60).padStart(2, '0')}
          </div>
        </div>
        <div class="seek-buttons flex-container">
          <button
            disabled=${!hasSongLoaded} 
            onMouseDown=${onSeekBackDown}
            onTouchStart=${onSeekBackDown} 
            onMouseUp=${onSeekUp} 
            onTouchEnd=${onSeekUp}
          >
            Seek -
          </button>
          <button 
            disabled=${!hasSongLoaded} 
            onMouseDown=${onSeekForwardDown}
            onTouchStart=${onSeekForwardDown}
            onMouseUp=${onSeekUp} 
            onTouchEnd=${onSeekUp}
          >
            Seek +
          </button>
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
          <button 
            disabled=${!hasSongLoaded} 
            onMouseDown=${onSetCueDown} 
            onTouchStart=${onSetCueDown}
            onMouseUp=${onSetCueUp} 
            onTouchEnd=${onSetCueUp}
            >
              Set Cue
          </button>
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
      <button 
        class="tempo-button" 
        onMouseDown=${onTempoMinusDown}
        onTouchStart=${onTempoMinusDown}
        onMouseUp=${onTempoButtonUp}
        onTouchEnd=${onTempoButtonUp}        
      >
      -
      </button>
      <hr class="zero-notch" />
      <input
        ref=${tempoRef}
        step="0.001" 
        type="range"
        min="90" 
        max="110" 
        orient="vertical"
        onInput=${onPitchChange} 
        onChange=${onPitchChangeEnd}
      >
      </input>
      <button 
        class="tempo-button"
        onMouseDown=${onTempoPlusDown}
        onTouchStart=${onTempoPlusDown}
        onMouseUp=${onTempoButtonUp}
        onTouchEnd=${onTempoButtonUp}  
      >
      +
      </button>
      </div>
    </div>
  </div>
  `;
}

render(html`<${App} />`, document.body);
