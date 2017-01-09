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

	constructor(){
		const p = path.join("mdbg", "mdbg.exe")
		this.debugProceses = spawn(p)

		this.debugProceses.stdout.on('data', (data) => {
			if(this.resolve)
			{
				this.answer += data.toString()
				if(this.answer.indexOf("mdbg>") > 0 )
				{
					this.resolve(this.answer);
					this.resolve = undefined;
					this.answer = "";
				}
			}
		});

		this.debugProceses.stderr.on('data', (data) => {
			if(this.reject)
			{
				this.answer += data.toString()
				if(this.answer.indexOf("mdbg>") > 0 )
				{
					this.reject(this.answer);
					this.reject = undefined;
					this.answer = "";
				}
			}
		});
	}


	private send(cmd : string)  : Promise<string> {
		this.debugProceses.stdin.write(cmd + "\n");
		return new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject
		})
	}


	public start (p : string) {
		return this.send(`r ${p}`)
	}

	public continue() {
		return this.send(`go`)
	}

	public setBreakpoint (file : string, line : number) {
		if(this.debugProceses)
		{
			let cmd = `b ${file}:${line}`
			return this.send(cmd);
		}
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


		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		this._mdbg = new Mdbg ();

		setTimeout(() => {
			// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
			// we request them early by sending an 'initializeRequest' to the frontend.
			// The frontend will end the configuration sequence by calling 'configurationDone' request.
			this.sendEvent(new InitializedEvent());

			// This debug adapter implements the configurationDoneRequest.
			response.body.supportsConfigurationDoneRequest = true;

			// make VS Code to use 'evaluate' when hovering over source
			response.body.supportsEvaluateForHovers = true;

			this.sendResponse(response);
		}, 1000)


	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void
	{
		this._mdbg
			.start(args.program)
			.then((d) => {
				console.log(d)
				if (args.stopOnEntry) {
					this.sendResponse(response);

					// we stop on the first line
					this.sendEvent(new StoppedEvent("entry", 1));
				} else {
					// we just start to run until we hit a breakpoint or an exception
					this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: 1 });
				}
			})

	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {

		// for (var ln = this._currentLine+1; ln < this._sourceLines.length; ln++) {
		// 	if (this.fireEventsForLine(response, ln)) {
		// 		return;
		// 	}
		// }
		this._mdbg.continue();

		this.sendResponse(response);
		// no more lines: run to end
		this.sendEvent(new TerminatedEvent());
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void
	{
		args.breakpoints.forEach ( (br) => {
			this._mdbg
                .setBreakpoint(args.source.path, br.line)
                .then((d) => {
				    console.log(d)
                })
		})
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void
	{}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void
	{}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void
	{}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void
	{}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments) : void
	{}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void
	{}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void
	{}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void
	{}


}

DebugSession.run(IonideDebugSession);
