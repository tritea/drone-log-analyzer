package main

import (
	"context"
	"embed"
	"io/fs"
	"log"

	appcfg "drone-log-analyzer/app/config"
	appmodel "drone-log-analyzer/app/model"
	_ "drone-log-analyzer/app/modules/parser/dataflash"
	_ "drone-log-analyzer/app/modules/parser/tlog"
	_ "drone-log-analyzer/app/modules/parser/ulog"
	"drone-log-analyzer/app/services/agentservice/agent"
	"drone-log-analyzer/app/services/configservice"
	"drone-log-analyzer/app/services/configservice/jsonstore"
	"drone-log-analyzer/app/services/logservice/dataflash"
	"drone-log-analyzer/app/services/mapservice/tilecache"
	httptransport "drone-log-analyzer/app/transport/http"
	wailsapp "drone-log-analyzer/app/transport/wails"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var staticFiles embed.FS

// llmConfigAdapter 把 configservice 适配为 agentservice 的配置源，
// 避免 service 之间直接 import（组合发生在 main）。
type llmConfigAdapter struct{ svc configservice.Service }

func (a llmConfigAdapter) LlmConfig(ctx context.Context) (*appmodel.LlmConfig, error) {
	resp, err := a.svc.GetLlmConfig(ctx)
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.Config == nil {
		return nil, nil
	}
	return resp.Config, nil
}

func main() {

	appcfg.MigrateConfigDir()

	sub, err := fs.Sub(staticFiles, "frontend/dist")
	if err != nil {
		log.Fatalf("load embedded frontend files failed: %v", err)
	}

	logSvc := dataflash.New()
	mapSvc := tilecache.New(appcfg.CacheDir())
	cfgSvc := jsonstore.New()
	defer func() {
		_ = logSvc.Close()
		_ = mapSvc.Close()
	}()

	agentAPI := &wailsapp.AgentAPI{}
	agentSvc := agent.New(agent.Deps{
		Log:  logSvc,
		Llm:  llmConfigAdapter{svc: cfgSvc},
		Sink: agentAPI.Emit,
	})
	agentAPI.Svc = agentSvc

	host := &wailsapp.HostAPI{Log: logSvc}

	router := httptransport.Router(mapSvc, cfgSvc, nil)

	err = wails.Run(&options.App{
		Title:     "飞控日志分析",
		Width:     1400,
		Height:    900,
		MinWidth:  800,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets:  sub,
			Handler: router,
		},

		OnStartup: func(ctx context.Context) {
			host.Startup(ctx)
			agentAPI.Startup(ctx)
		},
		Bind: []any{
			&wailsapp.LogAPI{Svc: logSvc},
			&wailsapp.MapAPI{Svc: mapSvc},
			&wailsapp.ConfigAPI{Svc: cfgSvc},
			agentAPI,
			host,
		},
	})
	if err != nil {
		log.Fatalf("wails run failed: %v", err)
	}
}
