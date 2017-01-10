import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, Variable
} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';
import * as fs  from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

// import {ChildProcess, spawn} from 'child_process'


export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the program to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
}

class Mdbg {
	private debugProceses : ChildProcess;
	private resolve : any;
	private reject: any;
	private answer = "";
	private busy = false;

	constructor(){
		const p = path.join("mdbg", "mdbg.exe")
		this.debugProceses = spawn(p)

		this.debugProceses.stdout.on('data', (data) => {
			if(this.resolve)
			{
				this.answer += data.toString()
				if(this.answer.indexOf("mdbg>") > 0 )
				{
					console.log("[ANSWER]\n" + this.answer)
					this.resolve(this.answer);
					this.resolve = undefined;
					this.answer = "";
					this.busy = false;
				}
			}
		});

		this.debugProceses.stderr.on('data', (data) => {
			if(this.reject)
			{
				this.answer += data.toString()
				if(this.answer.indexOf("mdbg>") > 0 )
				{
					console.log("[ERROR]\n" + this.answer)
					this.reject(this.answer);
					this.reject = undefined;
					this.answer = "";
					this.busy = false;

				}
			}
		});
	}

	private delay(t) {
		return new Promise(function(resolve) {
			setTimeout(resolve, t)
		});
	}

	private send(cmd : string)  : Promise<string> {
		if(!this.busy)
		{
			if (this.debugProceses)
			{
				this.busy = true;
				console.log("[REQ SEND] " + cmd)
				this.debugProceses.stdin.write(cmd + "\n");
				return new Promise((resolve, reject) => {
					this.resolve = resolve;
					this.reject = reject
				})
			}
			else
			{
				return Promise.reject("Mdbg not started")
			}
		}
		else
		{
			console.log("[REQ WAITING]" + cmd)
			return this.delay(100).then(() => this.send(cmd))
		}
	}


	public start (p : string) {
		return this.send(`r ${p}`)
	}

	public continue() {
		return this.send(`go`)
	}

	public next() {
		return this.send(`n`)
	}

	public setBreakpoint (file : string, line : number) {
		let cmd = `b ${file}:${line}`
		return this.send(cmd);
	}

	public getThreads() {
		return this.send(`t`)
	}

	public getStack(depth : number, thread: number) {
		return this.send(`w -c ${depth} ${thread}`)
	}

	public getVariables() {
		return this.send(`p`)
	}

	public getVariable(item : string) {
		return this.send(`p ${item}`)
	}
}

class IonideDebugSession extends DebugSession {

	private _mdbg : Mdbg;


	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super();
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void
	{
		console.log("[LOG] Init called")
		this._mdbg = new Mdbg ();


		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());

		// This debug adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		this.sendResponse(response);



	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void
	{
		console.log("[LOG] Launch called")

		this._mdbg
			.start(args.program)
			.then((d) => {
				if (args.stopOnEntry) {
					this.sendResponse(response);

					// we stop on the first line
					this.sendEvent(new StoppedEvent("breakpoint", 0));

				} else {
					// we just start to run until we hit a breakpoint or an exception
					this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: 0 });
				}
			})

	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		console.log("[LOG] Disconect called")
		super.disconnectRequest(response, args);
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		console.log("[LOG] Configuration called")
		this.sendResponse(response);
	}



	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void
	{
		console.log("[LOG] SetBreakpoints called")
		let brkPromise =
			args.breakpoints.map ( (br) => {
				return this._mdbg
						.setBreakpoint(path.basename(args.source.path), br.line)
						.then((d) => {

						});
			})
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void
	{
		console.log("[LOG] Threads called")
		this._mdbg
			.getThreads()
			.then(t => {
				try {
					let lines = t.split("\n").map((s) => s.trim()).filter(s => s.indexOf("th") === 0)
					let threads =
						lines
						.filter(n => n != "Active threads:")
						.map(n => {
							let thread = n.split("(")
							let name = thread[0].trim()
							let id = Number(name.split(":")[1])
							return new Thread(id, name)
						})
					response.body = { threads  }
					this.sendResponse(response)
				} catch (error) {
					response.body = {
						threads: []
					}
					this.sendResponse(response)
				}
			})
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void
	{
		console.log("[LOG] StackTrace called")
		this._mdbg
			.getStack(args.levels, args.threadId)
			.then(t => {
				let lines = t.split("\n")
							 .map((s) => s.trim())
							 .slice(1)
							 .filter((s) => {
								return s.indexOf("mdbg") < 0
							 })
				let frames =
					lines.map(n => {
						let ns = n.split(". ")
						let id = Number(ns[0].replace("*",""))
						let xs = ns[1].split("(")
						let name = xs[0].trim()
						let location = xs[1].replace(")","")

						var source : Source;
						var line : number;
						if (location === "source line information unavailable")
						{
							source = null
							line = 0
						}
						else
						{
							let locs = location.split(".fs:")
							let p = locs[0] + ".fs"
							line = Number(locs[1])
							source = new Source(path.basename(p), p)

						}

						return new StackFrame(id, name, source, line)

				});

				response.body = {
					stackFrames: frames,
					totalFrames: frames.length
				};
				this.sendResponse(response);

			})

	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void
	{
		console.log("[LOG] Scopes called")
		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Local", 1, false));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void
	{
		this._mdbg
			.getVariables()
			.then(t => {
				let vars =
					t.split("\n")
					.filter((s) => {
						return s.indexOf("mdbg") < 0
					})
					.map(line =>
					{
						let ls = line.split("=")
						return {
							name: ls[0],
							value: ls[1],
							variablesReference: 0
						}
					})
				response.body = {
					variables: vars
				};
				this.sendResponse(response);


			})
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void
	{
		console.log("[LOG] Continue called")
		// for (var ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {
		// 	if (this.fireEventsForLine(response, ln)) {
		// 		return;
		// 	}
		// }
		this._mdbg
			.continue()
			.then(o => {
				this.sendResponse(response);
				let lines = o.split("\n").map((s) => s.trim())

				if (lines.filter( s => s.indexOf("STOP: Process Exited") == 0).length > 0 )
				{
					this.sendEvent(new TerminatedEvent());
				}
				else if  (lines.filter( s => s.indexOf("STOP: Breakpoint") == 0).length > 0 ) {
					this.sendEvent(new StoppedEvent("breakpoint", 0));
				}
			})

		// no more lines: run to end
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void
	{
		console.log("[LOG] Next called")
		this._mdbg
			.next()
			.then(n => {
				this.sendResponse(response)
				this.sendEvent(new StoppedEvent("step", 0));

			})
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse): void {
		console.log("[LOG] StepIn called")
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
		console.log("[LOG] StepOut called")
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse): void {
		console.log("[LOG] Pause called")
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void
	{
		console.log("[LOG] StepBack called")
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void
	{
		console.log("[LOG] Evaluate called")
		this._mdbg
			.getVariable(args.expression)
			.then(p => {
				let v = p.split("\n")[0]


				response.body = {
					result: v,
					variablesReference: 0
				}
				this.sendResponse(response);

			})
	}


}

DebugSession.run(IonideDebugSession);
