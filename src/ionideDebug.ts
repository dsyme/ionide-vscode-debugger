import {
	DebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
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

	public setBreakpoint (file : string, line : number) {
		let cmd = `b ${file}:${line}`
		return this.send(cmd);
	}

	public getThreads() {
		return this.send(`t`)
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
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void
	{
		console.log("[LOG] Scopes called")
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void
	{
		console.log("[LOG] Variables called")
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

				if (lines.indexOf("STOP: Process Exited") > 0 )
				{
					this.sendEvent(new TerminatedEvent());
				}
				else {
					let bp = lines.indexOf("STOP: Breakpoint Hit")
					if (bp > 0) {
						let location = lines[bp+1]
					}
				}
			})

		// no more lines: run to end
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void
	{
		console.log("[LOG] Next called")
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
	}


}

DebugSession.run(IonideDebugSession);
