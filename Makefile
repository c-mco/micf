.PHONY: bundle build dev clean

bundle:
	@mkdir -p static/dist
	npx esbuild static/app.js --bundle --minify --format=iife --outfile=static/dist/bundle.js
	cat static/filter.js static/worker.js | npx esbuild --minify --loader=js > static/dist/worker.bundle.js
	npx esbuild static/app.css --bundle --minify --outfile=static/dist/app.min.css

build: bundle
	go build -o micf .

dev:
	air

clean:
	rm -rf static/dist tmp
