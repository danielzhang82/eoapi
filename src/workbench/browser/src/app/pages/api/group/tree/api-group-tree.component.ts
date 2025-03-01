import { debounce } from 'eo/workbench/browser/src/app/utils';
import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { Router, NavigationEnd, ActivatedRoute } from '@angular/router';
import { GroupTreeItem, GroupApiDataModel } from '../../../../shared/models';
import { Group, ApiData, StorageRes, StorageResStatus } from '../../../../shared/services/storage/index.model';
import { Message } from '../../../../shared/services/message/message.model';
import { NzModalRef, NzModalService } from 'ng-zorro-antd/modal';
import { NzFormatEmitEvent, NzTreeNode } from 'ng-zorro-antd/tree';
import { ApiGroupEditComponent } from '../edit/api-group-edit.component';
import { MessageService } from '../../../../shared/services/message';
import { filter, Subject, takeUntil } from 'rxjs';
import { getExpandGroupByKey, listToTree } from '../../../../utils/tree/tree.utils';
import { NzTreeComponent } from 'ng-zorro-antd/tree';
import { ModalService } from '../../../../shared/services/modal.service';
import { StorageService } from '../../../../shared/services/storage';
import { ElectronService } from '../../../../core/services';
import { createMockObj, IndexedDBStorage } from 'eo/workbench/browser/src/app/shared/services/storage/IndexedDB/lib/';
import { ApiService } from 'eo/workbench/browser/src/app/pages/api/api.service';
@Component({
  selector: 'eo-api-group-tree',
  templateUrl: './api-group-tree.component.html',
  styleUrls: ['./api-group-tree.component.scss'],
})
export class ApiGroupTreeComponent implements OnInit, OnDestroy {
  @ViewChild('apiGroup') apiGroup: NzTreeComponent;
  /**
   * Expanded keys of tree.
   */
  expandKeys: Array<string | number> = [];

  searchValue = '';
  /**
   * Default projectID.
   */
  projectID = 1;
  /**
   * All group items.
   */
  groupByID: { [key: number | string]: Group };
  /**
   * All api data items.
   */
  apiDataItems: { [key: number | string]: ApiData };

  /**
   * All Tree items.
   */
  treeItems: Array<GroupTreeItem>;
  /**
   * Level Tree nodes.
   */
  treeNodes: GroupTreeItem[] | NzTreeNode[] | any;
  fixedTreeNode: GroupTreeItem[] | NzTreeNode[] = [
    {
      title: $localize`:@@API Index:Index`,
      key: 'overview',
      weight: 0,
      parentID: '0',
      isLeaf: true,
      isFixed: true,
    },
  ];
  nzSelectedKeys: number[] = [];
  private destroy$: Subject<void> = new Subject<void>();
  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private modalService: ModalService,
    private messageService: MessageService,
    private storage: StorageService,
    public electron: ElectronService,
    public storageInstance: IndexedDBStorage,
    private apiService: ApiService,
    private nzModalService: NzModalService
  ) {}
  ngOnInit(): void {
    this.buildGroupTreeData();
    this.watchApiAction();
    this.watchRouterChange();
  }
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
  /**
   * Generate group tree nodes.
   */
  generateGroupTreeData(): void {
    this.treeItems.sort((a, b) => a.weight - b.weight);
    this.treeNodes = [];
    listToTree(this.treeItems, this.treeNodes, '0');
    setTimeout(() => {
      this.expandGroup();
    }, 0);
  }
  /**
   * Load all group and apiData items.
   */
  buildGroupTreeData = debounce(() => {
    this.groupByID = {};
    this.treeItems = [];
    this.getGroups();
  });
  getGroups() {
    this.storage.run('groupLoadAllByProjectID', [this.projectID], (result: StorageRes) => {
      if (result.status === StorageResStatus.success) {
        result.data.forEach((item) => {
          delete item.updatedAt;
          this.groupByID[item.uuid] = item;
          this.treeItems.push({
            title: item.name,
            key: `group-${item.uuid}`,
            weight: item.weight || 0,
            parentID: item.parentID ? `group-${item.parentID}` : '0',
            isLeaf: false,
          });
        });
      }
      this.getApis();
    });
  }
  async getApis() {
    const result: StorageRes = await this.apiService.getAll(this.projectID);
    const { success, empty } = StorageResStatus;
    if ([success, empty].includes(result.status)) {
      const apiItems = {};
      [].concat(result.data).forEach((item: ApiData) => {
        delete item.updatedAt;
        apiItems[item.uuid] = item;
        this.treeItems.push({
          title: item.name,
          key: item.uuid.toString(),
          weight: item.weight || 0,
          parentID: item.groupID ? `group-${item.groupID}` : '0',
          method: item.method,
          isLeaf: true,
        });
      });
      this.apiDataItems = apiItems;
      this.messageService.send({ type: 'loadApi', data: this.apiDataItems });
      this.setSelectedKeys();
      this.generateGroupTreeData();
      this.restoreExpandStatus();
    }
  }
  restoreExpandStatus() {
    const key = this.expandKeys.slice(0);
    this.expandKeys = [];
    this.expandKeys = key;
  }
  toggleExpand() {
    this.expandKeys = this.apiGroup.getExpandedNodeList().map((tree) => tree.key);
  }
  /**
   * Expand Select Group
   */
  private expandGroup() {
    if (!this.route.snapshot.queryParams.uuid) {
      return;
    }
    this.expandKeys = [
      ...this.expandKeys,
      ...(getExpandGroupByKey(this.apiGroup, this.route.snapshot.queryParams.uuid) || []),
    ];
  }
  async createGroup({ name, projectID, content }) {
    const groupID = await this.storageInstance.group.add({ name: name.replace(/\.json$/, ''), projectID });
    const result = content.apiData.map(({ uuid, ...it }, index) => ({ ...it, groupID }));
    const apiDataKeys = await this.storageInstance.apiData.bulkAdd(result, { allKeys: true });
    const apiData = result.map((n, i) =>
      createMockObj(n, { name: $localize`Default Mock`, createWay: 'system', apiDataID: apiDataKeys.at(i) })
    );
    this.storageInstance.mock.bulkAdd(apiData);
    this.buildGroupTreeData();
  }

  /**
   * Watch  apiData change event.
   */
  watchApiAction(): void {
    this.messageService
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((inArg: Message) => {
        switch (inArg.type) {
          case 'addApiSuccess':
          case 'editApiSuccess':
          case 'copyApiSuccess':
          case 'deleteApiSuccess':
          case 'updateGroupSuccess': {
            this.buildGroupTreeData();
            break;
          }
          case 'importSuccess': {
            this.createGroup({ projectID: 1, ...inArg.data });
          }
        }
      });
  }
  /**
   * Group tree click api event
   * Router jump page or Event emit
   *
   * @param inArg NzFormatEmitEvent
   */
  operateApiEvent(inArg: NzFormatEmitEvent | any): void {
    inArg.event.stopPropagation();
    switch (inArg.eventName) {
      case 'testApi':
      case 'editApi':
      case 'detailApi': {
        this.router.navigate([`/home/api/${inArg.eventName.replace('Api', '')}`], {
          queryParams: { uuid: inArg.node.key },
        });
        break;
      }
      case 'jumpOverview': {
        this.router.navigate(['/home/api/overview'], {
          queryParams: { uuid: 'overview' },
        });
        break;
      }
      case 'addAPI': {
        this.router.navigate(['/home/api/edit'], {
          queryParams: { groupID: inArg.node?.origin.key.replace('group-', '') },
        });
        break;
      }
      case 'deleteApi': {
        const apiInfo = inArg.node;
        this.nzModalService.confirm({
          nzTitle: $localize`Deletion Confirmation?`,
          nzContent: $localize`Are you sure you want to delete the data <strong title="${apiInfo.name}">${
            apiInfo.name.length > 50 ? apiInfo.name.slice(0, 50) + '...' : apiInfo.name
          }</strong> ? You cannot restore it once deleted!`,
          nzOnOk: () => {
            this.apiService.delete(apiInfo.uuid);
          },
        });
        break;
      }
      case 'copyApi': {
        this.apiService.copy(inArg.node);
        break;
      }
    }
  }
  /**
   * Group tree item click.
   *
   * @param event
   */
  clickTreeItem(event: NzFormatEmitEvent): void {
    const eventName = !event.node.isLeaf ? 'clickFolder' : event.node?.origin.isFixed ? 'clickFixedItem' : 'clickItem';
    switch (eventName) {
      case 'clickFolder': {
        event.node.isExpanded = !event.node.isExpanded;
        this.toggleExpand();
        break;
      }
      case 'clickFixedItem': {
        this.operateApiEvent({ ...event, eventName: 'jumpOverview' });
        break;
      }
      case 'clickItem': {
        this.operateApiEvent({ ...event, eventName: 'detailApi' });
        break;
      }
    }
  }

  /**
   * Build group model.
   *
   * @param parentID number
   * @return Group
   */
  buildGroupModel(parentID?: string): Group {
    const groupModel: Group = {
      projectID: 1,
      parentID: parentID ? Number(parentID.replace('group-', '')) : 0,
      weight: 0,
      name: '',
    };
    return groupModel;
  }
  /**
   * Create group.
   */
  addGroup() {
    this.groupModal($localize`Add Group`, { group: this.buildGroupModel(), action: 'new' });
  }

  /**
   * Create sub group.
   *
   * @param node NzTreeNode
   */
  addSubGroup(node: NzTreeNode) {
    this.groupModal($localize`Add Subgroup`, { group: this.buildGroupModel(node.key), action: 'sub' });
  }

  /**
   * Edit group.
   *
   * @param node NzTreeNode
   */
  editGroup(node: NzTreeNode) {
    this.groupModal($localize`Edit Group`, { group: this.nodeToGroup(node), action: 'edit' });
  }

  /**
   * Delete group.
   *
   * @param node NzTreeNode
   */
  deleteGroup(node: NzTreeNode) {
    this.groupModal($localize`Delete Group`, {
      group: this.nodeToGroup(node),
      treeItems: this.treeItems,
      action: 'delete',
    });
  }

  /**
   * Group edit modal.
   *
   * @param title
   * @param group
   */
  groupModal(title: string, params: object) {
    const modal: NzModalRef = this.modalService.create({
      nzTitle: title,
      nzContent: ApiGroupEditComponent,
      nzClosable: false,
      nzComponentParams: params,
      nzOnOk() {
        modal.componentInstance.submit();
      },
    });
  }

  /**
   * Drag & drop tree item.
   *
   * @param event
   */
  treeItemDrop = (event: NzFormatEmitEvent) => {
    const dragNode = event.dragNode;
    const groupApiData: GroupApiDataModel = { group: [], api: [] };
    if (dragNode.parentNode) {
      const parentNode = dragNode.parentNode;
      parentNode.getChildren().forEach((item: NzTreeNode, index: number) => {
        if (item.isLeaf) {
          groupApiData.api.push({ uuid: item.key, weight: index, groupID: parentNode.key });
        } else {
          groupApiData.group.push({ uuid: item.key, weight: index, parentID: parentNode.key });
        }
      });
    } else {
      const nodes = this.apiGroup.getTreeNodes().filter((n) => n.level === 0);
      nodes.forEach((item, index) => {
        if (item.isLeaf) {
          groupApiData.api.push({ uuid: item.key, weight: index, groupID: '0' });
        } else {
          groupApiData.group.push({ uuid: item.key, weight: index, parentID: '0' });
        }
      });
    }
    this.updateOperateApiEvent(groupApiData);
  };

  private replaceGroupKey(key: string) {
    return Number(key.replace('group-', ''));
  }
  /**
   * Update tree items after drag.
   *
   * @param data GroupApiDataModel
   */
  updateOperateApiEvent(data: GroupApiDataModel) {
    let count = 0;
    if (data.group.length > 0) {
      count++;
      console.log('data.group', data.group);
      this.storage.run(
        'groupBulkUpdate',
        [
          data.group.map((val) => ({
            ...val,
            uuid: this.replaceGroupKey(val.uuid),
            parentID: this.replaceGroupKey(val.parentID),
          })),
        ],
        (result: StorageRes) => {
          if (--count === 0) {
            this.buildGroupTreeData();
          }
        }
      );
    }
    if (data.api.length > 0) {
      count++;
      console.log('data.api', data.api);
      this.storage.run(
        'apiDataBulkUpdate',
        [
          data.api.map((n) => ({
            ...n,
            uuid: this.replaceGroupKey(n.uuid),
            groupID: this.replaceGroupKey(n.groupID),
          })),
        ],
        (result: StorageRes) => {
          if (--count === 0) {
            this.buildGroupTreeData();
          }
        }
      );
    }
  }
  /**
   * Expand Group fit current select api  when router change
   */
  private watchRouterChange() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((res: any) => {
      this.setSelectedKeys();
      this.expandGroup();
    });
  }
  private nodeToGroup(node: NzTreeNode): Group {
    return {
      projectID: 1,
      uuid: Number(node.origin.key.replace('group-', '')),
      name: node.origin.title,
      parentID: Number(node.origin.parentID.replace('group-', '')),
      weight: node.origin.weight,
    };
  }

  private setSelectedKeys() {
    if (this.route.snapshot.queryParams.uuid) {
      this.nzSelectedKeys = [this.route.snapshot.queryParams.uuid];
    } else {
      this.nzSelectedKeys = [];
    }
  }
}
