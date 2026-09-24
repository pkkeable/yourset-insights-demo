import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,accessSync,realpathSync,constants} from 'node:fs';
import path from 'node:path';
// Resolve before prepending the development shim; never spawn a bare PATH name.
const requestedDocker=process.env.DOCKER_BIN??(existsSync('/Applications/Docker.app/Contents/Resources/bin/docker')?'/Applications/Docker.app/Contents/Resources/bin/docker':'docker');
function resolveDocker(requested){
  const hasPath=path.isAbsolute(requested)||/[\\/]/.test(requested);
  const extensions=process.platform==='win32'&&!path.extname(requested)?['.exe','.com']:[''];
  const bases=hasPath?[path.resolve(requested)]:(process.env.PATH??'').split(path.delimiter).filter(Boolean).map(dir=>path.resolve(dir,requested));
  const shim=realpathSync(path.resolve('runtime-bin/docker'));
  for(const base of bases)for(const extension of extensions){
    try{
      const candidate=realpathSync(base+extension);
      if((process.platform==='win32'?candidate.toLowerCase():candidate)===(process.platform==='win32'?shim.toLowerCase():shim))continue;
      accessSync(candidate,process.platform==='win32'?constants.F_OK:constants.X_OK);
      return candidate;
    }catch{}
  }
  throw Error('Real Docker executable unavailable; set DOCKER_BIN to its absolute executable path.');
}
const docker=resolveDocker(requestedDocker);
const cli='./node_modules/.bin/supabase';
const env={...process.env,SUPABASE_TELEMETRY_DISABLED:'1',DO_NOT_TRACK:'1'};
if(!env.DOCKER_HOST&&existsSync(`${process.env.HOME}/.docker/run/docker.sock`))env.DOCKER_HOST=`unix://${process.env.HOME}/.docker/run/docker.sock`;
const network='yourset-spike-loopback';
env.SUPABASE_NETWORK_ID=network;
env.YOURSET_SPIKE_DOCKER_BIN=docker;
env.PATH=`${path.resolve('runtime-bin')}:${env.PATH}`;
const call=(cmd,args)=>execFileSync(cmd,args,{env,stdio:['ignore','pipe','pipe']});
let started=false;
try{
  call(docker,['info','--format','{{.ServerVersion}}']);
  try{call(docker,['network','inspect',network]);}catch{call(docker,['network','create','-o','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',network]);}
  const net=JSON.parse(call(docker,['network','inspect',network]))[0];if(net.Options['com.docker.network.bridge.host_binding_ipv4']!=='127.0.0.1')throw Error('network_not_loopback');
  console.log('Starting isolated local services; first run may download ARM images.');
  call(cli,['--network-id',network,'start','-x','realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);started=true;
  const names=call(docker,['ps','--filter','name=yourset-auth-spike','--format','{{.Names}}']).toString().trim().split('\n');
  for(const name of names){const container=JSON.parse(call(docker,['inspect',name]))[0];for(const bindings of Object.values(container.NetworkSettings.Ports??{})){for(const b of bindings??[])if(b.HostIp!=='127.0.0.1'){console.error(JSON.stringify({container:name,networks:Object.keys(container.NetworkSettings.Networks??{}),publishedAddress:b.HostIp,publishedPort:b.HostPort,requestedNetwork:network}));throw Error('non_loopback_port');}}}
  console.log('Verified all published test-service ports bind only to loopback.');
  const result=spawnSync(process.execPath,['test.mjs'],{env,stdio:'inherit'});process.exitCode=result.status??1;
}catch(e){console.error(['non_loopback_port','network_not_loopback'].includes(e.message)?e.message:'tool_failed');console.error('Local spike setup failed. No service credentials are printed. Check Docker and the pinned CLI; do not point this harness at a hosted project.');process.exitCode=1;}
finally{if(started){try{call(cli,['stop','--no-backup']);console.log('Disposed only the isolated spike containers and volumes.');call(docker,['network','rm',network]);console.log('Removed the isolated spike network.');}catch{console.error('Spike cleanup failed; stop the yourset-auth-spike project explicitly.');process.exitCode=1;}}}
