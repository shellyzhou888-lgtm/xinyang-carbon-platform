# 多项目数据库与数据库 Agent 方案

## 先区分三种“创建”权限

| 操作 | 所需权限 | 作用范围 |
| --- | --- | --- |
| `CREATE DATABASE new_project` | 角色属性 `CREATEDB` 或超级用户 | 在同一个 PostgreSQL 实例中新建数据库 |
| `CREATE SCHEMA business` | 当前数据库上的 `CREATE` 权限 | 在已连接的数据库中建 schema |
| `CREATE TABLE business.example (...)` | 目标 schema 上的 `CREATE` 权限 | 在该 schema 中建表 |

角色名和“应用账户”称呼不决定能力，实际授予的权限才决定。一个登录角色可以获准访问多个数据库；一次连接只进入其中一个数据库。角色在同一 PostgreSQL 实例内共享，因此不能只靠不同库名实现严格的项目隔离。参考 [PostgreSQL 17 角色属性](https://www.postgresql.org/docs/17/role-attributes.html)、[数据库与 schema](https://www.postgresql.org/docs/17/ddl-schemas.html)。

## 服务器现状（2026-10-20 只读核对）

| 数据库 | 所有者 | `zyz` 可连接 | `zyz` 可在库中建 schema |
| --- | --- | --- | --- |
| `carbonsystem` | `postgres` | 是 | 否 |
| `greensystem` | `greensystem` | 是 | 是 |
| `zyz` | `zyz` | 是 | 是 |

`zyz` 是非超级用户，`CREATEDB=false`；它当前可以在 `greensystem.public` 建表，但不能自行执行 `CREATE DATABASE`。因此，教师先前提供的另一个“应用账户”若确实能新建数据库，可能被授予了 `CREATEDB`，也可能是在云平台控制台由更高权限的身份代为创建。仅凭账户名称无法判断。[创建数据库的权限说明](https://www.postgresql.org/docs/17/manage-ag-createdb.html)

## 多项目如何分开

建议每个独立项目使用一个数据库：现有校园项目保留 `carbonsystem`，本园区项目使用 `greensystem`，新项目再建独立数据库。一个项目内部再用 schema 区分业务数据、登录、分析等模块。这样迁移、备份、权限和连接串都能按项目管理。

每个新项目同时建立自己的角色：

1. `项目_owner`：拥有数据库和业务 schema，通常不直接用于网站连接。
2. `项目_migrator`：只在执行受审查的建表、改表迁移时使用。
3. `项目_app`：网站服务端运行账户，只取得实际需要的查询和写入权限。
4. 按需增设只读角色，供报表或数据检查使用。

由管理员一次性创建新数据库和角色，不把 `CREATEDB` 授给网站运行账户。当前 `greensystem` 已存在且还是空库，可以继续以它作为园区项目开发库；`zyz` 可作临时开发连接。**建议在数据库 Agent 创建第一张业务表之前**，就确定本项目的迁移账户和独立网站账户，再设置授权。这样不必等页面写好后才切换账户。现有 `greensystem` 所有者角色可以作为迁移角色的权限基础；网站账户应只获得实际需要的业务权限。若需要独立测试，另建 `greensystem_test`；正式环境最好与开发环境分开。

同一实例中的数据库仍共享服务器资源和角色目录。若要求严格的网络、故障或管理员权限隔离，正式环境需要独立实例或服务器；仅分库不等于物理隔离。

## 数据库 Agent 如何工作

把数据库 Agent 设计成“产出并验证迁移”的助手，而不是持有 `postgres` 密码的长期数据库管理员：

1. **观察**：默认只读查看库、schema、表结构和权限；记录连接到的数据库及角色，防止连错库。
2. **设计**：先在仓库提交编号迁移 SQL、数据字典和回退说明；每次改动对应版本号与更新日志。
3. **执行**：用项目迁移角色在开发或测试库应用已审查的迁移，核对结果，再用网站运行角色测试真实页面查询与写入。
4. **发布**：正式库迁移前备份；涉及删表、删列或大量数据变动时单独审查，遵守本项目禁止批量删除的约定。

Agent 的日常查看连接应限制为只读；执行迁移时才临时使用迁移凭据。网站运行连接使用 `项目_app`，不使用超级用户。密码保存在本机或服务器的环境配置中，不提交 GitHub。

**本项目特别注意**：当前自动授权是“由 `postgres` 在 `public` 新建对象时授予 `zyz`”。若今后数据库 Agent 改用 `greensystem` 或新的迁移角色建表，这条默认授权不会自动套用；要针对实际建表角色配置 `ALTER DEFAULT PRIVILEGES`。它只影响未来对象，已有对象须另行 `GRANT`。在库仍为空时确定迁移角色，后续调整最省事。[默认权限说明](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)

当前方案仅记录建议，未创建新角色、数据库或业务表，也未更改服务器权限。
