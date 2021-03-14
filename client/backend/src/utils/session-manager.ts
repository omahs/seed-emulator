import dockerode from 'dockerode';
import { Duplex } from 'stream';
import { Logger } from 'tslog';
import { LogProducer } from '../interfaces/log-producer';

export interface Session {
    stream: Duplex,
    exec: dockerode.Exec
};

export class SessionManager implements LogProducer {
    private _logger: Logger;

    private _sessions: {
        [id: string]: Session
    };

    private _docker: dockerode;

    constructor(docker: dockerode) {
        this._sessions = {};
        this._docker = docker;
        this._logger = new Logger({ name: 'SessionManager' });
    }

    private async _getContainerRealId(id: string): Promise<string> {
        var containers = await this._docker.listContainers();
        var candidates = containers.filter(container => container.Id.startsWith(id));

        if (candidates.length != 1) {
            var err = `no match or multiple match for container ID ${id}`;
            this._logger.error(err);
            throw err;
        }

        return candidates[0].Id;
    }

    hasSession(fullId: string): boolean {
        return this._sessions[fullId] && this._sessions[fullId].stream.writable;
    }

    async getSession(id: string, command: string[] = ['bash']): Promise<Session> {
        this._logger.info(`getting container ${id}...`);

        var fullId = await this._getContainerRealId(id);
        this._logger.trace(`${id}'s full id: ${fullId}.`)

        var container = this._docker.getContainer(fullId);

        if (this._sessions[fullId]) {
            var session = this._sessions[fullId];
            this._logger.debug(`found existing session for ${id}, try re-attach...`);
            var stream = session.stream;
            if (stream.writable) {
                this._logger.info(`attached to existing session for ${id}.`);
                return session;
            }
            this._logger.info(`existing session for ${id} is invalid, creating new session.`);
        }

        this._logger.trace(`getting container ${id}...`);

        var execOpt = {
            AttachStdin: true,
            AttachStdout: true,
            AttachStderr: true,
            Tty: true,
            Cmd: command
        };
        this._logger.trace('spawning exec object with options:', execOpt);
        var exec = await container.exec(execOpt);
    
        var startOpt = {
            Tty: true,
            Detach: false,
            stdin: true,
            hijack: true
        };
        this._logger.trace('starting exec object with options:', startOpt);    
        var stream = await exec.start(startOpt);

        this._logger.info(`started session for container ${id}.`);

        this._sessions[fullId] = {
            stream, exec
        };

        return this._sessions[fullId];
    }

    getLoggers(): Logger[] {
        return [this._logger];
    }
};