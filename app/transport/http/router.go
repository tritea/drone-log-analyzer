package http

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"drone-log-analyzer/app/modules/maptiles"
	"drone-log-analyzer/app/services/configservice"
	"drone-log-analyzer/app/services/mapservice"

	"github.com/gin-gonic/gin"
)

func Router(mapSvc mapservice.Service, cfgSvc configservice.Service, staticHandler http.Handler) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/map/provider/:provider/:z/:x/:y", handleMapTile(mapSvc))

	r.GET("/model-file", handleModelFile())

	r.GET("/tiles/:id/*filepath", handleTilesetFile(cfgSvc))

	if staticHandler != nil {
		r.NoRoute(gin.WrapH(staticHandler))
	}
	return r
}

func handleModelFile() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := strings.TrimSpace(c.Query("path"))
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "path required"})
			return
		}
		data, err := os.ReadFile(path)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "model not found"})
			return
		}
		contentType := http.DetectContentType(data)
		if i := strings.IndexByte(contentType, ';'); i >= 0 {
			contentType = strings.TrimSpace(contentType[:i])
		}
		c.Header("Cache-Control", "public, max-age=3600")
		c.Data(http.StatusOK, contentType, data)
	}
}

// handleTilesetFile serves a 3D Tiles directory tree. Cesium loads
// tileset.json then streams the referenced .b3dm/.pnts children via relative
// paths and byte-range requests, so files are served with c.File (http.ServeFile
// under the hood: Range support + extension-based mime). The on-disk root is
// resolved by tileset name from configservice and confined to that root to
// prevent path traversal.
func handleTilesetFile(cfgSvc configservice.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		root, ok := cfgSvc.ResolveTilesetDir(c.Request.Context(), id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "tileset not found"})
			return
		}
		// Catch-all param includes a leading slash; force-absolute before Clean
		// so ".." segments collapse and cannot escape the root.
		rel := filepath.Clean("/" + c.Param("filepath"))
		full := filepath.Join(root, rel)
		if r, err := filepath.Rel(root, full); err != nil || strings.HasPrefix(r, "..") {
			c.JSON(http.StatusForbidden, gin.H{"error": "outside tileset root"})
			return
		}
		c.Header("Cache-Control", "public, max-age=3600")
		c.File(full)
	}
}

func handleMapTile(mapSvc mapservice.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		provider := strings.TrimSpace(c.Param("provider"))
		z, errZ := strconv.Atoi(c.Param("z"))
		x, errX := strconv.Atoi(c.Param("x"))
		y, errY := strconv.Atoi(c.Param("y"))
		if errZ != nil || errX != nil || errY != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid tile path"})
			return
		}

		resp, err := mapSvc.GetTile(c.Request.Context(), mapservice.TileRequest{
			Provider: provider, Z: z, X: x, Y: y,
		})
		if err != nil {
			switch {
			case errors.Is(err, mapservice.ErrMapUnavailable):
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
			case errors.Is(err, maptiles.ErrUnknownProvider), errors.Is(err, maptiles.ErrInvalidTile):
				c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			default:

				c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			}
			return
		}

		contentType := http.DetectContentType(resp.Bytes)
		if i := strings.IndexByte(contentType, ';'); i >= 0 {
			contentType = strings.TrimSpace(contentType[:i])
		}
		c.Header("Cache-Control", "public, max-age=86400")
		c.Data(http.StatusOK, contentType, resp.Bytes)
	}
}
