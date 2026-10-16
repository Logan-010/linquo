{
  description = "Linquo Flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    flake-utils.url = "github:numtide/flake-utils";

    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    naersk = {
      url = "github:nix-community/naersk";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      fenix,
      naersk,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        toolchain = fenix.packages.${system}.latest.toolchain;

        naersk-lib = pkgs.callPackage naersk {
          cargo = toolchain;
          rustc = toolchain;
        };

        frontend = pkgs.buildNpmPackage {
          pname = "linquo-frontend";
          version = "0.1.0";
          src = pkgs.lib.cleanSourceWith {
            src = ./frontend;
            filter =
              path: type:
              pkgs.lib.cleanSourceFilter path type
              && !(builtins.elem (builtins.baseNameOf path) [
                "node_modules"
                "dist"
              ]);
          };
          nodejs = pkgs.nodejs_26;
          npmDepsHash = "sha256-8u4acDntFrAHKnslGd/PnDLLL1EHZik/U6WF5dsxqpo=";
          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp -r dist/. "$out/"
            runHook postInstall
          '';
        };

        nativeBuildInputs = with pkgs; [ pkg-config ];

        buildInputs =
          with pkgs;
          [
            openssl
            sqlite
          ]
          ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [
            gtk3
            cairo
            glib
            dbus
            gdk-pixbuf
            webkitgtk_4_1
            libsoup_3
            librsvg
            glib-networking
            gsettings-desktop-schemas
          ];

        app = naersk-lib.buildPackage {
          name = "linquo";
          version = (builtins.fromTOML (builtins.readFile ./linquo-app/Cargo.toml)).package.version;
          root = ./.;
          src = pkgs.lib.cleanSourceWith {
            src = ./.;
            filter =
              path: type:
              pkgs.lib.cleanSourceFilter path type
              && !(builtins.elem (builtins.baseNameOf path) [
                "target"
                "node_modules"
                "dist"
                ".direnv"
              ]);
          };
          inherit nativeBuildInputs buildInputs;
          cargoBuildOptions =
            options:
            options
            ++ [
              "--package"
              "linquo"
              "--bin"
              "linquo"
              "--features"
              "custom-protocol"
              "--locked"
            ];

          overrideMain = attrs: {
            nativeBuildInputs =
              attrs.nativeBuildInputs
              ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.wrapGAppsHook3 ];
            postPatch = (attrs.postPatch or "") + ''
              mkdir -p frontend/dist
              cp -r ${frontend}/. frontend/dist/
            '';
          };

          meta = {
            description = "Linquo language learning app";
            mainProgram = "linquo";
            platforms = pkgs.lib.platforms.linux ++ pkgs.lib.platforms.darwin;
          };
        };
      in
      {
        packages.default = app;
        packages.linquo = app;
        packages.frontend = frontend;

        apps.default = {
          type = "app";
          program = "${app}/bin/linquo";
        };

        devShells.default = pkgs.mkShell (
          {
            inherit nativeBuildInputs buildInputs;
            packages = with pkgs; [
              # Rust
              toolchain
              rust-analyzer
              cargo-tauri

              # JavaScript / TypeScript
              nodejs_26
              typescript
              typescript-language-server
              prefetch-npm-deps

              # Development
              git
              just
            ];

            RUST_SRC_PATH = "${toolchain}/lib/rustlib/src/rust/library";
          }
          // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            GIO_EXTRA_MODULES = "${pkgs.glib-networking}/lib/gio/modules";
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath buildInputs;
          }
        );
      }
    );
}
