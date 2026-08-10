package main

import (
	"embed"
	"io/fs"
	"log"

	appcfg "drone-log-analyzer/app/config"
	_ "drone-log-analyzer/app/modules/parser/dataflash"
	_ "drone-log-analyzer/app/modules/parser/tlog"
	_ "drone-log-analyzer/app/modules/parser/ulog"
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

		OnStartup: host.Startup,
		Bind: []any{
			&wailsapp.LogAPI{Svc: logSvc},
			&wailsapp.MapAPI{Svc: mapSvc},
			&wailsapp.ConfigAPI{Svc: cfgSvc},
			host,
		},
	})
	if err != nil {
		log.Fatalf("wails run failed: %v", err)
	}
}
