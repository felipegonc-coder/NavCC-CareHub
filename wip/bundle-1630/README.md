# Pages work in progress

A backup of the pages parts that aren't on a pull request yet (2a spaces, 3a pages, 3b tree and move, 3b-2 archive and page look, 3c Trash), with PR 1 as on #49 and the local check scripts. Not for merging.

    cat wip/bundle-1630/part-0* | base64 -d > pages.tar.xz   # sha256 eafdd2469715defd22a42d2040ec7de69da81ace34b82b18fa7dc6117ff6e0ae
    tar xJf pages.tar.xz
