class PositionReportingProcessor extends AudioWorkletProcessor {
  process(inputs, _outputs, _parameters) {
    if (inputs.length > 0) {
      const input = inputs[0];
      if (input.length > 0) {
        const channel = input[0];
        this.port.postMessage(channel[channel.length - 1]);
        return true;
      }
    }
    return false;
  }
}

registerProcessor('position-reporting-processor', PositionReportingProcessor);