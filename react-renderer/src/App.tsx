import * as React from "react";
import Log from "./Log";
import Canvas from "./Canvas";
import ButtonBar from "./ButtonBar";
import { ILayer } from "./types";
import { Step, Resample, converged, initial } from "./packets";
import { Protocol, ConnectionStatus } from "./Protocol";
import { evalTranslation, decodeState } from "./Evaluator";
import { step, stepEP, stepBasic } from "./Optimizer";
import { unwatchFile } from "fs";
import { collectLabels } from "./utills/CollectLabels";
import * as tf from "@tensorflow/tfjs";

// Cache compiled functions after first sample
// TODO: Hack -- remove! Global state in frontend -- what's the right way to do this?
// let resampled = false;
// let objective: any;
// let gradient: any;

interface ICanvasState {
  data: State | undefined; // NOTE: if the backend is not connected, data will be undefined, TODO: rename this field
  autostep: boolean;
  layers: ILayer[];
  processedInitial: boolean;
  penroseVersion: string;
}

const socketAddress = "ws://localhost:9160";

const stepState = async (state: State, onUpdate: any) => {
  // NOTE: this will greatly improve the performance of the optmizer
  // TODO: where's the right place to put this? Is there an "on start up" place?
  // tf.setBackend("cpu");
  // tf.enableProdMode();

  // TODO: Redo perf numbers for this extra factor of 10??
  const numSteps = 1;
  // const numSteps = 2;

  // const newState = step(state!, numSteps);
  // const newState = stepEP(state!, numSteps);

  // TODO: Hack -- remove!
  // state.params.functionsCompiled = resampled;
  // if (resampled) {
  //   state.params.objective = objective;
  //   state.params.gradient = gradient;
  // }

  // console.log("functionsCompiled", state.params.functionsCompiled);
  const newState = stepBasic(state!, numSteps);

  // onUpdate(newState);
  const labeledShapes: any = await collectLabels(newState.shapes);
  onUpdate({ ...newState, shapes: labeledShapes }); // callback for React state update

  // TODO: Hack -- remove! sets it every step
  // objective = state.params.objective;
  // gradient = state.params.gradient;
};

class App extends React.Component<any, ICanvasState> {
  public readonly state: ICanvasState = {
    data: undefined,
    autostep: false,
    processedInitial: false, // TODO: clarify the semantics of this flag
    layers: [
      { layer: "polygon", enabled: false },
      { layer: "bbox", enabled: false },
    ],
    penroseVersion: "",
  };
  public readonly canvas = React.createRef<Canvas>();
  public readonly buttons = React.createRef<ButtonBar>();
  public protocol: Protocol;
  public onConnectionStatus = (conn: ConnectionStatus) => {
    Log.info(`Connection status: ${conn}`);
  };
  public onVersion = (version: string) => {
    this.setState({ penroseVersion: version });
  };
  public onCanvasState = async (canvasState: State, _: any) => {
    // HACK: this will enable the "animation" that we normally expect
    await new Promise((r) => setTimeout(r, 1));

    await this.setState({
      data: canvasState,
      processedInitial: true,
    });
    const { autostep } = this.state;
    if (autostep && !converged(canvasState)) {
      await this.step();
    }
  };
  public downloadSVG = () => {
    if (this.canvas.current !== null) {
      this.canvas.current.downloadSVG();
    }
  };
  public downloadPDF = () => {
    if (this.canvas.current !== null) {
      this.canvas.current.downloadPDF();
    }
  };
  public autoStepToggle = async () => {
    await this.setState({ autostep: !this.state.autostep });
    if (this.state.autostep && this.state.processedInitial) {
      this.step();
    }
  };
  public step = () => {
    // this.protocol.sendPacket(Step(1, this.state.data));
    stepState(this.state.data!, this.onCanvasState);
  };

  public resample = async () => {
    const NUM_SAMPLES = 50;
    // resampled = true;
    await this.setState({ processedInitial: false });
    this.protocol.sendPacket(Resample(NUM_SAMPLES, this.state.data));
  };

  public toggleLayer = (layerName: string) => {
    this.setState({
      layers: this.state.layers.map(({ layer, enabled }: ILayer) => {
        if (layerName === layer) {
          return { layer, enabled: !enabled };
        }
        return { layer, enabled };
      }),
    });
  };

  public async componentDidMount() {
    this.protocol = new Protocol(socketAddress, {
      onConnectionStatus: this.onConnectionStatus,
      onVersion: this.onVersion,
      onCanvasState: this.onCanvasState,
      onError: console.warn,
      kind: "renderer",
    });

    this.protocol.setupSockets();
  }

  public updateData = async (data: any) => {
    await this.setState({ data: { ...data } });
    if (this.state.autostep) {
      stepState(data, this.state.autostep);
    }
  };

  public render() {
    const { data, layers, autostep, penroseVersion } = this.state;
    return (
      <div className="App" style={{ height: "100vh" }}>
        <ButtonBar
          downloadPDF={this.downloadPDF}
          downloadSVG={this.downloadSVG}
          autostep={autostep}
          step={this.step}
          autoStepToggle={this.autoStepToggle}
          resample={this.resample}
          converged={data ? converged(data) : false} // TODO: what should be the default value here?
          initial={data ? initial(data) : false}
          toggleLayer={this.toggleLayer}
          layers={layers}
          ref={this.buttons}
        />
        <Canvas
          data={data}
          updateData={this.updateData}
          lock={false}
          layers={layers}
          ref={this.canvas}
          penroseVersion={penroseVersion}
        />
      </div>
    );
  }
}

export default App;
